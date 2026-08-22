import Fluent
import Foundation
import Vapor

protocol RepositoryRecordListing: Sendable {
    func listRecordsPage(
        account: LinkedAccount,
        collection: String,
        cursor: String?,
        client: Client
    ) async throws -> ListRecordsResponse<JSONValue>

    func fetchBlob(
        account: LinkedAccount,
        cid: String,
        maximumByteSize: Int,
        client: Client
    ) async throws -> Data?
}

extension ATProtoXRPCClient: RepositoryRecordListing {}

protocol PublishedPostBackfilling: Sendable {
    func backfill(account: LinkedAccount, req: Request) async throws -> [Draft]
}

/// Published documents already live in the account's public repository, so posts written outside
/// AnyPub — or before this workspace existed — are imported as published drafts on demand.
struct PublishedPostBackfillService: PublishedPostBackfilling, Sendable {
    private static let maximumPages = 50
    private static let maximumBlobByteSize = 10 * 1_024 * 1_024
    private static let wrapperCollections: [PublicationHost: String] = [
        .offprint: "app.offprint.document.article",
        .pckt: "blog.pckt.document",
    ]

    private let records: any RepositoryRecordListing

    init(records: any RepositoryRecordListing = ATProtoXRPCClient()) {
        self.records = records
    }

    /// Concurrent requests for the same account share one import so a document is never imported twice.
    func backfill(account: LinkedAccount, req: Request) async throws -> [Draft] {
        try await backfillCoordinator.run(for: account.did) {
            try await self.importDocuments(account: account, req: req)
        }
    }

    private func importDocuments(account: LinkedAccount, req: Request) async throws -> [Draft] {
        let publications = try await publications(for: account, req: req)
        guard !publications.isEmpty else { return [] }

        let existing = try await Draft.query(on: req.db)
            .filter(\.$accountDID, .equal, account.did)
            .all()
        let known = Set(existing.flatMap { [$0.documentURI, $0.retainedDocumentURI].compactMap { $0 } })

        let documents = try await listAll(collection: "site.standard.document", account: account, req: req)
        let candidates = documents.filter { record in
            guard let reference = try? ATRecordReference(uri: record.uri) else { return false }
            return reference.repo == account.did
                && reference.collection == "site.standard.document"
                && !known.contains(record.uri)
        }
        guard !candidates.isEmpty else { return [] }

        let wrappers = try await wrapperReferences(
            hosts: Set(publications.values.compactMap(\.publicationHost)),
            account: account,
            req: req
        )

        var imported: [Draft] = []
        for record in candidates {
            // One unreadable document must not strand the rest of the account's published posts.
            do {
                let blob = try await contentBlob(for: record, account: account, req: req)
                guard let document = DocumentImporter.imported(record: record, contentBlob: blob) else {
                    req.logger.warning("Skipping unreadable published document", metadata: ["uri": "\(record.uri)"])
                    continue
                }
                guard let publication = publications[document.publicationURI] else {
                    req.logger.debug("Skipping a document for an unknown publication", metadata: [
                        "uri": "\(record.uri)",
                        "site": "\(document.publicationURI)",
                    ])
                    continue
                }
                let draft = try await draft(
                    for: document,
                    record: record,
                    publication: publication,
                    wrapper: wrappers[record.uri],
                    account: account,
                    req: req
                )
                try await draft.save(on: req.db)
                imported.append(draft)
            } catch {
                req.logger.error("Could not import a published document", metadata: [
                    "uri": "\(record.uri)",
                    "error": "\(String(describing: error))",
                ])
            }
        }

        req.logger.info("Backfilled published posts", metadata: [
            "accountDID": "\(account.did)",
            "count": "\(imported.count)",
        ])
        return imported
    }

    private func publications(for account: LinkedAccount, req: Request) async throws -> [String: PublicationCache] {
        var cached = try await PublicationCache.query(on: req.db)
            .filter(\.$accountDID, .equal, account.did)
            .all()
        if cached.isEmpty {
            cached = try await req.application.publicationDiscovery.sync(account: account, req: req)
        }
        return Dictionary(cached.map { ($0.uri, $0) }, uniquingKeysWith: { first, _ in first })
    }

    private func draft(
        for document: ImportedDocument,
        record: RepositoryRecord<JSONValue>,
        publication: PublicationCache,
        wrapper: StrongReference?,
        account: LinkedAccount,
        req: Request
    ) async throws -> Draft {
        let cover = try await localAsset(for: document.cover, account: account, req: req)
        let markdown = try await resolvedMarkdown(document, account: account, req: req)
        let publishedAt = document.publishedAt ?? document.updatedAt ?? Date()

        let draft = try Draft(
            accountDID: account.did,
            publicationURI: publication.uri,
            publicationURL: publication.url,
            title: document.title,
            path: document.path,
            excerpt: document.description,
            tags: document.tags,
            markdown: markdown,
            coverAssetID: cover?.id,
            status: .published,
            publishedAt: publishedAt,
            createdAt: publishedAt,
            updatedAt: document.updatedAt ?? publishedAt
        )
        draft.documentURI = record.uri
        draft.documentCID = record.cid
        draft.platformDocumentURI = wrapper?.uri
        draft.platformDocumentCID = wrapper?.cid
        return draft
    }

    /// Body images become local assets so the editor can render them and a republish reuses the
    /// original blob. Images that cannot be downloaded degrade to a link rather than a broken block.
    private func resolvedMarkdown(_ document: ImportedDocument, account: LinkedAccount, req: Request) async throws -> String {
        guard !document.images.isEmpty else { return document.markdown }
        var markdown = document.markdown
        var resolved: [String: UUID] = [:]

        for image in document.images {
            let placeholder = "\(DocumentImporter.blobPlaceholderScheme)\(image.cid)"
            if let assetID = resolved[image.cid] {
                markdown = markdown.replacingOccurrences(of: placeholder, with: "anypub-asset://\(assetID)")
                continue
            }
            if let asset = try await localAsset(for: image, account: account, req: req), let assetID = asset.id {
                resolved[image.cid] = assetID
                markdown = markdown.replacingOccurrences(of: placeholder, with: "anypub-asset://\(assetID)")
            } else if let url = atprotoBlobURL(pdsURL: account.pdsURL, did: account.did, cid: image.cid) {
                markdown = linkingUnavailableImages(in: markdown, placeholder: placeholder, url: url)
            }
        }
        return markdown
    }

    /// An image AnyPub cannot store locally stays readable as a link, because an image block whose
    /// source is not a local asset would fail draft validation on the next save.
    private func linkingUnavailableImages(in markdown: String, placeholder: String, url: String) -> String {
        markdown.components(separatedBy: "\n").map { line in
            guard line.contains(placeholder) else { return line }
            let linked = line.replacingOccurrences(of: placeholder, with: url)
            return linked.hasPrefix("![") ? String(linked.dropFirst()) : linked
        }.joined(separator: "\n")
    }

    private func localAsset(
        for image: ImportedBlob?,
        account: LinkedAccount,
        req: Request
    ) async throws -> CoverAsset? {
        guard let image else { return nil }
        guard let data = try await records.fetchBlob(
            account: account,
            cid: image.cid,
            maximumByteSize: Self.maximumBlobByteSize,
            client: req.client
        ) else {
            req.logger.warning("Skipping an unavailable published image blob", metadata: ["cid": "\(image.cid)"])
            return nil
        }

        var buffer = ByteBufferAllocator().buffer(capacity: data.count)
        buffer.writeBytes(data)
        let stored = try AssetStorage().store(
            buffer: buffer,
            filename: "\(image.cid)\(fileExtension(for: image.mimeType))",
            accountDID: account.did,
            req: req
        )
        let blob = ATProtoBlobRef(
            type: "blob",
            ref: .init(link: image.cid),
            mimeType: image.mimeType,
            size: stored.byteSize
        )
        let asset = CoverAsset(
            accountDID: account.did,
            source: .publication,
            filePath: stored.filePath,
            mimeType: image.mimeType,
            byteSize: stored.byteSize,
            altText: image.alt.isEmpty ? nil : image.alt,
            width: image.width,
            height: image.height,
            attributionJSON: nil,
            blobJSON: String(decoding: try JSONEncoder().encode(blob), as: UTF8.self)
        )
        try await asset.save(on: req.db)
        return asset
    }

    private func contentBlob(
        for record: RepositoryRecord<JSONValue>,
        account: LinkedAccount,
        req: Request
    ) async throws -> Data? {
        guard let cid = DocumentImporter.contentBlobCID(value: record.value) else { return nil }
        return try await records.fetchBlob(
            account: account,
            cid: cid,
            maximumByteSize: Self.maximumBlobByteSize,
            client: req.client
        )
    }

    /// Offprint and pckt posts pair the canonical document with a host wrapper record, keyed here by
    /// the document URI it points at so unpublishing later removes both records.
    private func wrapperReferences(
        hosts: Set<PublicationHost>,
        account: LinkedAccount,
        req: Request
    ) async throws -> [String: StrongReference] {
        var references: [String: StrongReference] = [:]
        for (host, collection) in Self.wrapperCollections where hosts.contains(host) {
            let wrappers: [RepositoryRecord<JSONValue>]
            do {
                wrappers = try await listAll(collection: collection, account: account, req: req)
            } catch {
                req.logger.warning("Could not list wrapper records", metadata: [
                    "collection": "\(collection)",
                    "error": "\(String(describing: error))",
                ])
                continue
            }
            for wrapper in wrappers {
                guard let documentURI = wrapper.value.objectValue?["document"]?.objectValue?["uri"]?.stringValue,
                      let cid = wrapper.cid
                else { continue }
                references[documentURI] = StrongReference(uri: wrapper.uri, cid: cid)
            }
        }
        return references
    }

    private func listAll(
        collection: String,
        account: LinkedAccount,
        req: Request
    ) async throws -> [RepositoryRecord<JSONValue>] {
        var cursor: String?
        var seenCursors = Set<String>()
        var all: [RepositoryRecord<JSONValue>] = []

        for _ in 0..<Self.maximumPages {
            let page = try await records.listRecordsPage(
                account: account,
                collection: collection,
                cursor: cursor,
                client: req.client
            )
            all += page.records
            guard !page.records.isEmpty, let nextCursor = page.cursor else { return all }
            guard seenCursors.insert(nextCursor).inserted else {
                throw Abort(.badGateway, reason: "PDS repeated a record listing cursor")
            }
            cursor = nextCursor
        }
        return all
    }

    private func fileExtension(for mimeType: String) -> String {
        switch mimeType.lowercased() {
        case "image/png": ".png"
        case "image/jpeg", "image/jpg": ".jpg"
        case "image/gif": ".gif"
        case "image/webp": ".webp"
        case "image/avif": ".avif"
        default: ".bin"
        }
    }
}

private let backfillCoordinator = BackfillCoordinator()

private actor BackfillCoordinator {
    private var tasks: [String: Task<[Draft], Error>] = [:]

    func run(
        for did: String,
        operation: @escaping @Sendable () async throws -> [Draft]
    ) async throws -> [Draft] {
        if let task = tasks[did] { return try await task.value }
        let task = Task { try await operation() }
        tasks[did] = task
        defer { tasks[did] = nil }
        return try await task.value
    }
}

private struct PublishedPostBackfillKey: StorageKey {
    typealias Value = any PublishedPostBackfilling
}

extension Application {
    var publishedPostBackfill: any PublishedPostBackfilling {
        get { storage[PublishedPostBackfillKey.self] ?? PublishedPostBackfillService() }
        set { storage[PublishedPostBackfillKey.self] = newValue }
    }
}
