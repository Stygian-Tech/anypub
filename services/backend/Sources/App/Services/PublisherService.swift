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
    private let pcktVerifier = PcktPublicationVerifier()
    private let tidGenerator = ATProtoTIDGenerator()

    func publish(draft: Draft, req: Request) async throws -> PublishResult {
        guard let draftID = draft.id else { throw Abort(.badRequest, reason: "Draft must be saved before publishing") }
        guard [.draft, .failed, .scheduled, .published].contains(draft.typedStatus) else {
            throw Abort(.conflict, reason: "The draft is already being published")
        }
        let existingDocumentURI = draft.documentURIForPublishing
        let existingPlatformDocumentURI = draft.platformDocumentURIForPublishing
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

        let offprintDocumentRkey: String?
        if host == .pckt {
            draft.path = pcktCompatiblePath(title: draft.title, path: draft.path, draftID: draftID)
            offprintDocumentRkey = nil
        } else if host == .offprint {
            let rkey = try existingDocumentURI.map { try ATRecordReference(uri: $0).rkey }
                ?? tidGenerator.generate()
            draft.path = offprintCompatiblePath(title: draft.title, path: draft.path, documentRkey: rkey)
            offprintDocumentRkey = rkey
        } else {
            offprintDocumentRkey = nil
        }

        let canonical = try CanonicalDocumentLoader.load(draft: draft)
        let bodyImages = try await publishedBodyImages(
            for: canonical,
            draft: draft,
            account: account,
            req: req
        )
        let prepared = try PublicationContentAdapter.prepare(
            document: canonical,
            host: host,
            description: host == .pckt ? draft.excerpt : nil,
            images: bodyImages
        )
        let pcktPublicationURI = try await host == .pckt
            ? pcktVerifier.verify(
                standardPublicationURI: draft.publicationURI,
                account: account,
                client: req.client
            ).uri
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
                textContent: prepared.textContent,
                pcktCompatible: host == .pckt
            )
            let documentResponse: CreateRecordResponse
            let platformResponse: CreateRecordResponse?
            if host == .pckt {
                guard let pcktPublicationURI else {
                    throw Abort(.unprocessableEntity, reason: "The pckt publication reference is missing")
                }
                let rkey = try existingDocumentURI.map { try ATRecordReference(uri: $0).rkey }
                    ?? tidGenerator.generate()
                let repositoryHead = try await xrpc.getLatestCommit(account: account, client: req.client)
                let documentExists = try await xrpc.getRecord(
                    account: account,
                    collection: "site.standard.document",
                    rkey: rkey,
                    client: req.client
                ) != nil
                let wrapperExists = try await xrpc.getRecord(
                    account: account,
                    collection: "blog.pckt.document",
                    rkey: rkey,
                    client: req.client
                ) != nil
                let result = try await xrpc.applyPcktDocumentWrites(
                    account: account,
                    tokenEncryption: req.application.tokenEncryption,
                    database: req.db,
                    rkey: rkey,
                    document: document,
                    pcktPublicationURI: pcktPublicationURI,
                    documentExists: documentExists,
                    wrapperExists: wrapperExists,
                    swapCommit: repositoryHead.cid,
                    client: req.client
                )
                documentResponse = result.document
                platformResponse = result.wrapper
            } else if host == .offprint {
                guard let documentRkey = offprintDocumentRkey else {
                    throw Abort(.internalServerError, reason: "The Offprint document record key is missing")
                }
                let wrapperRkey = try existingPlatformDocumentURI.map { try ATRecordReference(uri: $0).rkey }
                    ?? tidGenerator.generate()
                let repositoryHead = try await xrpc.getLatestCommit(account: account, client: req.client)
                let documentExists = try await xrpc.getRecord(
                    account: account,
                    collection: "site.standard.document",
                    rkey: documentRkey,
                    client: req.client
                ) != nil
                let wrapperExists = try await xrpc.getRecord(
                    account: account,
                    collection: "app.offprint.document.article",
                    rkey: wrapperRkey,
                    client: req.client
                ) != nil
                let result = try await xrpc.applyOffprintDocumentWrites(
                    account: account,
                    tokenEncryption: req.application.tokenEncryption,
                    database: req.db,
                    documentRkey: documentRkey,
                    wrapperRkey: wrapperRkey,
                    document: document,
                    documentExists: documentExists,
                    wrapperExists: wrapperExists,
                    swapCommit: repositoryHead.cid,
                    client: req.client
                )
                documentResponse = result.document
                platformResponse = result.wrapper
            } else {
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

                platformResponse = nil
            }

            draft.documentURI = documentResponse.uri
            draft.documentCID = documentResponse.cid
            draft.platformDocumentURI = platformResponse?.uri
            draft.platformDocumentCID = platformResponse?.cid
            draft.discardRetainedPublishingIdentity()
            draft.publishedAt = document.publishedAt.date
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
        let platformDocumentURI = draft.platformDocumentURI
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

        if let platformDocumentURI,
           let platformReference = try? ATRecordReference(uri: platformDocumentURI),
           platformReference.collection == "blog.pckt.document",
           platformReference.rkey == reference.rkey {
            let repositoryHead = try await xrpc.getLatestCommit(account: account, client: req.client)
            try await xrpc.applyPcktDocumentDeletes(
                account: account,
                tokenEncryption: req.application.tokenEncryption,
                database: req.db,
                rkey: reference.rkey,
                swapCommit: repositoryHead.cid,
                client: req.client
            )
            draft.platformDocumentURI = nil
            draft.platformDocumentCID = nil
        } else if let platformDocumentURI,
                  let platformReference = try? ATRecordReference(uri: platformDocumentURI),
                  platformReference.collection == "app.offprint.document.article" {
            let repositoryHead = try await xrpc.getLatestCommit(account: account, client: req.client)
            try await xrpc.applyOffprintDocumentDeletes(
                account: account,
                tokenEncryption: req.application.tokenEncryption,
                database: req.db,
                documentRkey: reference.rkey,
                wrapperRkey: platformReference.rkey,
                swapCommit: repositoryHead.cid,
                client: req.client
            )
            draft.platformDocumentURI = nil
            draft.platformDocumentCID = nil
        } else {
            if let platformDocumentURI {
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
        }
        draft.retainedDocumentURI = documentURI
        draft.retainedPlatformDocumentURI = platformDocumentURI
        draft.documentURI = nil
        draft.documentCID = nil
        draft.platformDocumentURI = nil
        draft.platformDocumentCID = nil
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
        case .markpubMarkdown(let payload):
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

    private func coverBlob(for draft: Draft, account: LinkedAccount, req: Request) async throws -> ATProtoBlobRef? {
        guard let coverAssetID = draft.coverAssetID,
              let asset = try await CoverAsset.find(coverAssetID, on: req.db)
        else { return nil }

        guard asset.accountDID == draft.accountDID else {
            throw Abort(.forbidden, reason: "The selected cover image belongs to another account")
        }

        return try await blob(for: asset, account: account, req: req)
    }

    private func publishedBodyImages(
        for document: CanonicalDocument,
        draft: Draft,
        account: LinkedAccount,
        req: Request
    ) async throws -> [PublishedBodyImage] {
        var result: [PublishedBodyImage] = []
        var seen: Set<UUID> = []
        for block in document.blocks {
            guard case .image(let assetID, let alt) = block, seen.insert(assetID).inserted else { continue }
            guard let asset = try await CoverAsset.find(assetID, on: req.db) else {
                throw Abort(.unprocessableEntity, reason: "A body image no longer exists")
            }
            guard asset.accountDID == draft.accountDID else {
                throw Abort(.forbidden, reason: "A body image belongs to another account")
            }
            let uploadedBlob = try await blob(for: asset, account: account, req: req)
            result.append(PublishedBodyImage(
                assetID: assetID,
                blob: uploadedBlob,
                alt: alt,
                width: asset.width ?? 1,
                height: asset.height ?? 1,
                publicURL: try publicBlobURL(account: account, blob: uploadedBlob)
            ))
        }
        return result
    }

    private func blob(for asset: CoverAsset, account: LinkedAccount, req: Request) async throws -> ATProtoBlobRef {

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

    private func publicBlobURL(account: LinkedAccount, blob: ATProtoBlobRef) throws -> String {
        guard var components = URLComponents(string: account.pdsURL) else {
            throw Abort(.internalServerError, reason: "The account PDS URL is invalid")
        }
        components.path = "/xrpc/com.atproto.sync.getBlob"
        components.queryItems = [
            URLQueryItem(name: "did", value: account.did),
            URLQueryItem(name: "cid", value: blob.ref.link),
        ]
        guard let url = components.url?.absoluteString else {
            throw Abort(.internalServerError, reason: "Could not create the published image URL")
        }
        return url
    }
}

func pcktCompatiblePath(title: String, path: String?, draftID: UUID) -> String {
    let current = path?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let source = current.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let titleSlug = title.folding(options: [.diacriticInsensitive, .widthInsensitive], locale: .current).lowercased()
        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    let discriminator = draftID.uuidString
        .replacingOccurrences(of: "-", with: "")
        .lowercased()
        .suffix(7)
    if source.hasSuffix("-\(discriminator)") {
        return current.hasPrefix("/") ? current : "/\(current)"
    }

    let base = source.isEmpty ? titleSlug : source
    return "/\(base.isEmpty ? "untitled-article" : base)-\(discriminator)"
}

func offprintCompatiblePath(title: String, path: String?, documentRkey: String) -> String {
    let current = path?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let nativePrefix = "/a/\(documentRkey)-"
    if current.hasPrefix(nativePrefix), current.count > nativePrefix.count {
        return current
    }

    var source = current.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if source.hasPrefix("a/") {
        source.removeFirst(2)
        if let separator = source.firstIndex(of: "-") {
            source = String(source[source.index(after: separator)...])
        }
    }
    let titleSlug = title.folding(options: [.diacriticInsensitive, .widthInsensitive], locale: .current).lowercased()
        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    let sourceSlug = source.lowercased()
        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    let slug = sourceSlug.isEmpty ? titleSlug : sourceSlug
    return "\(nativePrefix)\(slug.isEmpty ? "untitled-article" : slug)"
}
