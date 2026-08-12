import Foundation
import Vapor

struct PublishResult: Content, Sendable {
    let documentURI: String
    let documentCID: String
    let platformDocumentURI: String?
    let platformDocumentCID: String?
    let calendarEventURI: String?
    let calendarEventCID: String?
}

struct PublisherService: Sendable {
    private let records = ProtocolRecordBuilder()
    private let xrpc = ATProtoXRPCClient()

    func publish(draft: Draft, req: Request) async throws -> PublishResult {
        guard let draftID = draft.id else { throw Abort(.badRequest, reason: "Draft must be saved before publishing") }
        guard [.draft, .failed, .scheduled, .published].contains(draft.typedStatus) else {
            throw Abort(.conflict, reason: "The draft is already being published")
        }
        let existingDocumentURI = draft.documentURI
        let existingPlatformDocumentURI = draft.platformDocumentURI
        let isUpdate = existingDocumentURI != nil
        guard let account = try await LinkedAccount.query(on: req.db)
            .filter(\.$did, .equal, draft.accountDID)
            .first()
        else {
            throw Abort(.notFound, reason: "Linked account not found")
        }

        guard let publication = try await PublicationCache.query(on: req.db)
            .filter(\.$accountDID, .equal, draft.accountDID)
            .filter(\.$uri, .equal, draft.publicationURI)
            .first(),
              let host = publication.publicationHost
        else {
            throw Abort(.unprocessableEntity, reason: "The selected publication has no supported content adapter")
        }

        let canonical = try CanonicalDocumentLoader.load(draft: draft)
        let prepared = try PublicationContentAdapter.prepare(document: canonical, host: host)
        let pcktPublicationURI = try await host == .pckt
            ? verifiedPcktPublicationURI(for: draft, account: account, req: req)
            : nil

        draft.typedStatus = .publishing
        draft.plaintext = canonical.plaintext
        draft.updatedAt = Date()
        try await draft.save(on: req.db)

        do {
            let content = try await preparedContent(prepared, account: account, req: req)
            let cover = try await coverBlob(for: draft, account: account, req: req)
            let document = records.documentRecord(
                draft: draft,
                cover: cover,
                content: content,
                pcktCompatible: host == .pckt
            )
            let documentResponse: CreateRecordResponse
            if let existingDocumentURI, isUpdate {
                documentResponse = try await xrpc.putDocument(
                    account: account,
                    tokenEncryption: req.application.tokenEncryption,
                    database: req.db,
                    rkey: try ATRecordReference(uri: existingDocumentURI).rkey,
                    record: document,
                    client: req.client
                )
            } else {
                documentResponse = try await xrpc.createDocument(
                    account: account,
                    tokenEncryption: req.application.tokenEncryption,
                    database: req.db,
                    record: document,
                    client: req.client
                )
            }

            let platformResponse: CreateRecordResponse?
            do {
                platformResponse = try await createPlatformDocument(
                    host: host,
                    pcktPublicationURI: pcktPublicationURI,
                    document: documentResponse,
                    existingPlatformDocumentURI: existingPlatformDocumentURI,
                    account: account,
                    req: req
                )
            } catch {
                if isUpdate {
                    draft.documentURI = documentResponse.uri
                    draft.documentCID = documentResponse.cid
                    try? await draft.save(on: req.db)
                    throw Abort(.badGateway, reason: "The canonical document was updated, but its platform wrapper could not be refreshed")
                }
                do {
                    try await xrpc.deleteRecord(
                        account: account,
                        tokenEncryption: req.application.tokenEncryption,
                        database: req.db,
                        recordURI: documentResponse.uri,
                        client: req.client
                    )
                } catch let cleanupError {
                    draft.documentURI = documentResponse.uri
                    draft.documentCID = documentResponse.cid
                    try? await draft.save(on: req.db)
                    throw Abort(
                        .badGateway,
                        reason: "Platform wrapper failed and the canonical document could not be removed: \(cleanupError)"
                    )
                }
                throw error
            }

            draft.documentURI = documentResponse.uri
            draft.documentCID = documentResponse.cid
            draft.platformDocumentURI = platformResponse?.uri
            draft.platformDocumentCID = platformResponse?.cid
            draft.publishedAt = document.publishedAt
            draft.typedStatus = .published
            draft.updatedAt = Date()
            try await draft.save(on: req.db)

            let event: CreateRecordResponse?
            do {
                event = try await upsertCalendarEvent(for: draft, account: account, articleURI: documentResponse.uri, req: req)
            } catch {
                event = nil
                req.logger.error("Article published, but calendar event update failed: \(String(describing: error))")
            }
            try await PublishAttempt(draftID: draftID, status: "published", message: nil).save(on: req.db)

            return PublishResult(
                documentURI: documentResponse.uri,
                documentCID: documentResponse.cid,
                platformDocumentURI: platformResponse?.uri,
                platformDocumentCID: platformResponse?.cid,
                calendarEventURI: event?.uri,
                calendarEventCID: event?.cid
            )
        } catch {
            draft.typedStatus = .failed
            draft.updatedAt = Date()
            try? await draft.save(on: req.db)
            try? await PublishAttempt(draftID: draftID, status: "failed", message: String(describing: error)).save(on: req.db)
            throw error
        }
    }

    func upsertCalendarEvent(for draft: Draft, account: LinkedAccount, articleURI: String?, req: Request) async throws -> CreateRecordResponse? {
        guard let draftID = draft.id else { return nil }
        let eventRecord = records.calendarEventRecord(draft: draft, articleURI: articleURI)

        if let link = try await CalendarEventLink.query(on: req.db).filter(\.$draftID, .equal, draftID).first(),
           let rkey = link.eventURI.split(separator: "/").last.map(String.init) {
            let response = try await xrpc.putCalendarEvent(
                account: account,
                tokenEncryption: req.application.tokenEncryption,
                database: req.db,
                rkey: rkey,
                record: eventRecord,
                client: req.client
            )
            link.eventCID = response.cid
            link.updatedAt = Date()
            try await link.save(on: req.db)
            return response
        }

        let response = try await xrpc.createCalendarEvent(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            database: req.db,
            record: eventRecord,
            client: req.client
        )
        try await CalendarEventLink(draftID: draftID, eventURI: response.uri, eventCID: response.cid).save(on: req.db)
        return response
    }

    func unpublish(draft: Draft, req: Request) async throws {
        guard let documentURI = draft.documentURI else { return }
        let reference = try ATRecordReference(uri: documentURI)
        guard reference.collection == "site.standard.document" else {
            throw Abort(.badRequest, reason: "Published linkage is not a standard.site document")
        }
        guard let account = try await LinkedAccount.query(on: req.db)
            .filter(\.$did, .equal, draft.accountDID)
            .first()
        else {
            throw Abort(.notFound, reason: "Linked account not found")
        }

        try await deleteCalendarEvent(for: draft, account: account, req: req)

        if let platformDocumentURI = draft.platformDocumentURI {
            try await xrpc.deleteRecord(
                account: account,
                tokenEncryption: req.application.tokenEncryption,
                database: req.db,
                recordURI: platformDocumentURI,
                client: req.client
            )
            draft.platformDocumentURI = nil
            draft.platformDocumentCID = nil
            draft.updatedAt = Date()
            try await draft.save(on: req.db)
        }
        try await xrpc.deleteRecord(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            database: req.db,
            recordURI: documentURI,
            client: req.client
        )
        draft.documentURI = nil
        draft.documentCID = nil
        draft.publishedAt = nil
        draft.scheduledAt = nil
        draft.typedStatus = .draft
        draft.updatedAt = Date()
        try await draft.save(on: req.db)
    }

    func deleteCalendarEvent(for draft: Draft, req: Request) async throws {
        guard let account = try await LinkedAccount.query(on: req.db)
            .filter(\.$did, .equal, draft.accountDID)
            .first()
        else {
            guard let draftID = draft.id else { return }
            if try await CalendarEventLink.query(on: req.db).filter(\.$draftID, .equal, draftID).first() == nil {
                return
            }
            throw Abort(.notFound, reason: "Linked account not found")
        }
        try await deleteCalendarEvent(for: draft, account: account, req: req)
    }

    private func deleteCalendarEvent(for draft: Draft, account: LinkedAccount, req: Request) async throws {
        guard let draftID = draft.id,
              let link = try await CalendarEventLink.query(on: req.db).filter(\.$draftID, .equal, draftID).first()
        else { return }
        try await xrpc.deleteRecord(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            database: req.db,
            recordURI: link.eventURI,
            client: req.client
        )
        try await link.delete(on: req.db)
    }

    private func preparedContent(
        _ prepared: PreparedPublicationContent,
        account: LinkedAccount,
        req: Request
    ) async throws -> JSONValue {
        guard let offload = prepared.offload else { return prepared.content }
        let data: Data
        switch offload {
        case .leafletPages(let payload):
            data = payload
        case .pcktItems(let payload):
            data = payload
        }
        let blob = try await xrpc.uploadBlob(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            database: req.db,
            data: data,
            mimeType: offload.mimeType,
            client: req.client
        )
        return prepared.replacingOffload(with: blob)
    }

    private func verifiedPcktPublicationURI(
        for draft: Draft,
        account: LinkedAccount,
        req: Request
    ) async throws -> String {
        let publication = try ATRecordReference(uri: draft.publicationURI)
        let exists = try await xrpc.recordExists(
            account: account,
            collection: "blog.pckt.publication",
            rkey: publication.rkey,
            client: req.client
        )
        guard exists else {
            throw Abort(.unprocessableEntity, reason: "The selected standard.site publication has no matching pckt publication")
        }
        return "at://\(publication.repo)/blog.pckt.publication/\(publication.rkey)"
    }

    private func createPlatformDocument(
        host: PublicationHost,
        pcktPublicationURI: String?,
        document: CreateRecordResponse,
        existingPlatformDocumentURI: String?,
        account: LinkedAccount,
        req: Request
    ) async throws -> CreateRecordResponse? {
        let reference = StrongReference(uri: document.uri, cid: document.cid)
        switch host {
        case .leaflet:
            return nil
        case .offprint:
            if let existingPlatformDocumentURI {
                return try await xrpc.putOffprintArticle(
                    account: account,
                    tokenEncryption: req.application.tokenEncryption,
                    database: req.db,
                    rkey: try ATRecordReference(uri: existingPlatformDocumentURI).rkey,
                    record: OffprintArticleRecord(document: reference),
                    client: req.client
                )
            }
            return try await xrpc.createOffprintArticle(
                account: account,
                tokenEncryption: req.application.tokenEncryption,
                database: req.db,
                record: OffprintArticleRecord(document: reference),
                client: req.client
            )
        case .pckt:
            guard let pcktPublicationURI else {
                throw Abort(.unprocessableEntity, reason: "The pckt publication reference is missing")
            }
            let rkey = try ATRecordReference(uri: document.uri).rkey
            return try await xrpc.putPcktDocument(
                account: account,
                tokenEncryption: req.application.tokenEncryption,
                database: req.db,
                rkey: rkey,
                record: PcktDocumentRecord(document: reference, site: pcktPublicationURI),
                client: req.client
            )
        }
    }

    private func coverBlob(for draft: Draft, account: LinkedAccount, req: Request) async throws -> ATProtoBlobRef? {
        guard let coverAssetID = draft.coverAssetID,
              let asset = try await CoverAsset.find(coverAssetID, on: req.db)
        else { return nil }

        if let blobJSON = asset.blobJSON,
           let data = blobJSON.data(using: .utf8),
           let blob = try? JSONDecoder().decode(ATProtoBlobRef.self, from: data) {
            return blob
        }

        let data = try Data(contentsOf: URL(fileURLWithPath: asset.filePath))
        let blob = try await xrpc.uploadBlob(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            database: req.db,
            data: data,
            mimeType: asset.mimeType,
            client: req.client
        )
        asset.blobJSON = String(decoding: try JSONEncoder().encode(blob), as: UTF8.self)
        try await asset.save(on: req.db)
        return blob
    }
}
