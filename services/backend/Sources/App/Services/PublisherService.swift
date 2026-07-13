import Foundation
import Vapor

struct PublishResult: Content, Sendable {
    let documentURI: String
    let documentCID: String
    let calendarEventURI: String?
    let calendarEventCID: String?
}

struct PublisherService: Sendable {
    private let records = ProtocolRecordBuilder()
    private let xrpc = ATProtoXRPCClient()

    func publish(draft: Draft, req: Request) async throws -> PublishResult {
        guard let draftID = draft.id else { throw Abort(.badRequest, reason: "Draft must be saved before publishing") }
        guard let account = try await LinkedAccount.query(on: req.db)
            .filter(\.$did, .equal, draft.accountDID)
            .first()
        else {
            throw Abort(.notFound, reason: "Linked account not found")
        }

        draft.typedStatus = .publishing
        draft.updatedAt = Date()
        try await draft.save(on: req.db)

        do {
            let cover = try await coverBlob(for: draft, account: account, req: req)
            let publication = try await PublicationCache.query(on: req.db)
                .filter(\.$uri, .equal, draft.publicationURI)
                .first()
            let document = records.documentRecord(draft: draft, cover: cover, host: publication?.publicationHost)
            let documentResponse = try await xrpc.createDocument(
                account: account,
                tokenEncryption: req.application.tokenEncryption,
                record: document,
                client: req.client
            )

            draft.documentURI = documentResponse.uri
            draft.documentCID = documentResponse.cid
            draft.publishedAt = document.publishedAt
            draft.typedStatus = .published
            draft.updatedAt = Date()
            try await draft.save(on: req.db)

            let event = try await upsertCalendarEvent(for: draft, account: account, articleURI: documentResponse.uri, req: req)
            try await PublishAttempt(draftID: draftID, status: "published", message: nil).save(on: req.db)

            return PublishResult(
                documentURI: documentResponse.uri,
                documentCID: documentResponse.cid,
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
            record: eventRecord,
            client: req.client
        )
        try await CalendarEventLink(draftID: draftID, eventURI: response.uri, eventCID: response.cid).save(on: req.db)
        return response
    }

    func deletePublishedDocument(for draft: Draft, req: Request) async throws {
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

        try await xrpc.deleteRecord(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            recordURI: documentURI,
            client: req.client
        )
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
            data: data,
            mimeType: asset.mimeType,
            client: req.client
        )
        asset.blobJSON = String(decoding: try JSONEncoder().encode(blob), as: UTF8.self)
        try await asset.save(on: req.db)
        return blob
    }
}
