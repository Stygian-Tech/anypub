@testable import App
import Fluent
import Foundation
import Testing
import Vapor
import VaporTesting

@Suite("Published post backfill")
struct PublishedPostBackfillTests {
    private static let markdown = """
    # Field notes

    A paragraph with **bold**, *italic*, `code`, ~~struck~~, and a [link](https://example.com).

    ## Lists

    - First item
    \t- Nested item
    - Second item

    1. Step one
    2. Step two

    - [x] Packed
    - [ ] Shipped

    > Quoted line one
    > Quoted line two

    ```swift
    let value = 1
    ```

    ---

    @[embed](https://example.com/embedded)
    """

    @Test("Leaflet, Offprint, and pckt bodies import back to their published Markdown")
    func structuredContentRoundTrip() throws {
        let document = CanonicalDocumentLoader.loadMarkdown(Self.markdown)

        for host in [PublicationHost.leaflet, .offprint, .pckt] {
            let prepared = try PublicationContentAdapter.prepare(document: document, host: host)
            let imported = try #require(DocumentImporter.imported(
                record: documentRecord(content: prepared.content, textContent: prepared.textContent)
            ))
            #expect(imported.markdown == Self.markdown, "\(host.rawValue) body did not round-trip")
        }
    }

    @Test("Markpub bodies import their published Markdown verbatim")
    func markpubContentRoundTrip() throws {
        let document = CanonicalDocumentLoader.loadMarkdown(Self.markdown)
        let prepared = try PublicationContentAdapter.prepare(document: document, host: .markpub)
        let published = try #require(
            prepared.content.objectValue?["text"]?.objectValue?["markdown"]?.stringValue
        )
        let imported = try #require(DocumentImporter.imported(
            record: documentRecord(content: prepared.content, textContent: prepared.textContent)
        ))

        // Markpub publishes embeds as plain links, so its round-trip matches the published body.
        #expect(imported.markdown == published)
        #expect(imported.markdown.hasSuffix("[https://example.com/embedded](https://example.com/embedded)"))
    }

    @Test("Offloaded bodies import from the content blob")
    func offloadedContentImport() throws {
        let document = CanonicalDocumentLoader.loadMarkdown("# Offloaded\n\nA long body lives in a blob.")
        let prepared = try PublicationContentAdapter.prepare(document: document, host: .leaflet)
        let pages = try #require(prepared.content.objectValue?["pages"])
        let content = JSONValue.object([
            "$type": .string("pub.leaflet.content"),
            "pages": .array([]),
            "blobPages": testBlob(cid: "pages-cid", mimeType: "application/json"),
        ])
        let record = documentRecord(content: content, textContent: prepared.textContent)

        #expect(DocumentImporter.contentBlobCID(value: record.value) == "pages-cid")
        let imported = try #require(DocumentImporter.imported(
            record: record,
            contentBlob: try JSONEncoder().encode(pages)
        ))
        #expect(imported.markdown == "# Offloaded\n\nA long body lives in a blob.")
    }

    @Test("pckt summary headings stay in the excerpt instead of the body")
    func pcktSummaryHeading() throws {
        let document = CanonicalDocumentLoader.loadMarkdown("The body of the post.")
        let prepared = try PublicationContentAdapter.prepare(
            document: document,
            host: .pckt,
            description: "A short summary"
        )
        var value = documentRecord(content: prepared.content, textContent: prepared.textContent).value.objectValue ?? [:]
        value["description"] = .string("A short summary")
        let imported = try #require(DocumentImporter.imported(record: RepositoryRecord<JSONValue>(
            uri: "at://did:plc:writer/site.standard.document/3lsummary",
            cid: "record-cid",
            value: .object(value)
        )))

        #expect(imported.description == "A short summary")
        #expect(imported.markdown == "The body of the post.")
    }

    @Test("Documents without readable content fall back to their plaintext")
    func plaintextFallback() throws {
        let record = documentRecord(
            content: .object(["$type": .string("com.example.unknown.content")]),
            textContent: "First line\nSecond line"
        )
        let imported = try #require(DocumentImporter.imported(record: record))

        #expect(imported.markdown == "First line\n\nSecond line")
    }

    @Test("Document metadata imports title, path, tags, description, and timestamps")
    func metadataImport() throws {
        let record = RepositoryRecord<JSONValue>(
            uri: "at://did:plc:writer/site.standard.document/3lmeta",
            cid: "record-cid",
            value: .object([
                "$type": .string("site.standard.document"),
                "site": .string("at://did:plc:writer/site.standard.publication/publication"),
                "title": .string("Metadata"),
                "path": .string("/metadata"),
                "description": .string("An excerpt"),
                "tags": .array([.string("release"), .string("")]),
                "publishedAt": .string("2026-07-06T13:00:00.000Z"),
                "updatedAt": .string("2026-07-07T13:00:00Z"),
                "coverImage": testBlob(cid: "cover-cid", mimeType: "image/png"),
                "textContent": .string("Body"),
            ])
        )
        let imported = try #require(DocumentImporter.imported(record: record))

        #expect(imported.title == "Metadata")
        #expect(imported.path == "/metadata")
        #expect(imported.description == "An excerpt")
        #expect(imported.tags == ["release"])
        #expect(imported.publishedAt == Date(timeIntervalSince1970: 1_783_342_800))
        #expect(imported.updatedAt == Date(timeIntervalSince1970: 1_783_429_200))
        #expect(imported.cover?.cid == "cover-cid")
        #expect(imported.cover?.mimeType == "image/png")
    }

    @Test("Records from other collections and without a publication are ignored")
    func unrelatedRecords() throws {
        let wrongType = RepositoryRecord<JSONValue>(
            uri: "at://did:plc:writer/site.standard.document/3lother",
            cid: "cid",
            value: .object([
                "$type": .string("app.offprint.document.article"),
                "site": .string("at://did:plc:writer/site.standard.publication/publication"),
                "title": .string("Wrapper"),
            ])
        )
        let siteless = RepositoryRecord<JSONValue>(
            uri: "at://did:plc:writer/site.standard.document/3lsiteless",
            cid: "cid",
            value: .object(["$type": .string("site.standard.document"), "title": .string("Orphan")])
        )

        #expect(DocumentImporter.imported(record: wrongType) == nil)
        #expect(DocumentImporter.imported(record: siteless) == nil)
    }

    @Test("Body images import as local assets that reuse the published blob")
    func bodyImageImport() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:images"
            let account = linkedAccount(did: did)
            try await publicationCache(did: did, host: .leaflet).save(on: app.db)
            let content = JSONValue.object([
                "$type": .string("pub.leaflet.content"),
                "pages": .array([.object([
                    "$type": .string("pub.leaflet.pages.linearDocument"),
                    "blocks": .array([.object([
                        "$type": .string("pub.leaflet.pages.linearDocument#block"),
                        "block": .object([
                            "$type": .string("pub.leaflet.blocks.image"),
                            "image": testBlob(cid: "body-image-cid", mimeType: "image/png"),
                            "alt": .string("A diagram"),
                            "aspectRatio": .object(["width": .integer(640), "height": .integer(480)]),
                        ]),
                    ])]),
                ])]),
            ])
            let lister = StubRecordLister(
                pages: ["site.standard.document": [
                    "": ListRecordsResponse(
                        records: [documentRecord(did: did, rkey: "3limage", content: content, textContent: "A diagram")],
                        cursor: nil
                    ),
                ]],
                blobs: ["body-image-cid": Data(repeating: 7, count: 32)]
            )
            let request = Request(application: app, on: app.eventLoopGroup.next())

            let imported = try await PublishedPostBackfillService(records: lister)
                .backfill(account: account, req: request)

            let draft = try #require(imported.first)
            let assetID = try #require(UUID(uuidString: String(
                draft.markdown.dropFirst("![A diagram](anypub-asset://".count).dropLast()
            )))
            let asset = try #require(try await CoverAsset.find(assetID, on: app.db))
            #expect(asset.accountDID == did)
            #expect(asset.width == 640)
            #expect(asset.height == 480)
            #expect(asset.blobJSON?.contains("body-image-cid") == true)
            #expect(FileManager.default.fileExists(atPath: asset.filePath))
            try? FileManager.default.removeItem(atPath: asset.filePath)
        }
    }

    @Test("Backfill stores published drafts and links host wrapper records")
    func backfillCreatesPublishedDrafts() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:backfill"
            let account = linkedAccount(did: did)
            try await publicationCache(did: did, host: .pckt).save(on: app.db)
            let content = JSONValue.object([
                "$type": .string("blog.pckt.content"),
                "items": .array([.object([
                    "$type": .string("blog.pckt.block.text"),
                    "plaintext": .string("Published elsewhere"),
                ])]),
            ])
            let lister = StubRecordLister(pages: [
                "site.standard.document": [
                    "": ListRecordsResponse(
                        records: [documentRecord(did: did, rkey: "3lpckt", content: content, textContent: "Published elsewhere")],
                        cursor: nil
                    ),
                ],
                "blog.pckt.document": [
                    "": ListRecordsResponse(
                        records: [RepositoryRecord<JSONValue>(
                            uri: "at://\(did)/blog.pckt.document/3lpckt",
                            cid: "wrapper-cid",
                            value: .object([
                                "$type": .string("blog.pckt.document"),
                                "document": .object([
                                    "uri": .string("at://\(did)/site.standard.document/3lpckt"),
                                    "cid": .string("record-cid"),
                                ]),
                            ])
                        )],
                        cursor: nil
                    ),
                ],
            ])
            let request = Request(application: app, on: app.eventLoopGroup.next())

            let imported = try await PublishedPostBackfillService(records: lister)
                .backfill(account: account, req: request)

            let draft = try #require(imported.first)
            #expect(imported.count == 1)
            #expect(draft.typedStatus == .published)
            #expect(draft.documentURI == "at://\(did)/site.standard.document/3lpckt")
            #expect(draft.documentCID == "record-cid")
            #expect(draft.platformDocumentURI == "at://\(did)/blog.pckt.document/3lpckt")
            #expect(draft.platformDocumentCID == "wrapper-cid")
            #expect(draft.publicationURL == "https://publication.example")
            #expect(draft.markdown == "Published elsewhere")
            #expect(draft.publishedAt == Date(timeIntervalSince1970: 1_783_342_800))
            #expect(try await Draft.query(on: app.db).filter(\.$accountDID, .equal, did).count() == 1)
        }
    }

    @Test("Backfill skips tracked documents, other publications, and repeats")
    func backfillSkipsKnownAndUnrelatedDocuments() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:repeat-backfill"
            let account = linkedAccount(did: did)
            try await publicationCache(did: did, host: .leaflet).save(on: app.db)
            let tracked = try Draft(
                accountDID: did,
                publicationURI: "at://\(did)/site.standard.publication/publication",
                publicationURL: "https://publication.example",
                title: "Already tracked",
                path: "/tracked",
                excerpt: nil,
                tags: [],
                markdown: "Tracked",
                status: .published
            )
            tracked.documentURI = "at://\(did)/site.standard.document/3ltracked"
            try await tracked.save(on: app.db)

            let content = JSONValue.object([
                "$type": .string("pub.leaflet.content"),
                "pages": .array([]),
            ])
            let foreign = documentRecord(did: did, rkey: "3lforeign", content: content, textContent: "Foreign")
            let lister = StubRecordLister(pages: ["site.standard.document": [
                "": ListRecordsResponse(
                    records: [
                        documentRecord(did: did, rkey: "3ltracked", content: content, textContent: "Tracked"),
                        RepositoryRecord<JSONValue>(
                            uri: foreign.uri,
                            cid: foreign.cid,
                            value: .object((foreign.value.objectValue ?? [:]).merging([
                                "site": .string("at://\(did)/site.standard.publication/unknown"),
                            ]) { _, new in new })
                        ),
                        documentRecord(did: did, rkey: "3lnew", content: content, textContent: "New post"),
                    ],
                    cursor: nil
                ),
            ]])
            let request = Request(application: app, on: app.eventLoopGroup.next())
            let service = PublishedPostBackfillService(records: lister)

            let imported = try await service.backfill(account: account, req: request)
            #expect(imported.map(\.documentURI) == ["at://\(did)/site.standard.document/3lnew"])
            #expect(imported.first?.markdown == "New post")

            let repeated = try await service.backfill(account: account, req: request)
            #expect(repeated.isEmpty)
            #expect(try await Draft.query(on: app.db).filter(\.$accountDID, .equal, did).count() == 2)
        }
    }

    @Test("Backfill paginates and rejects a repeated cursor")
    func backfillPagination() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:paginated-backfill"
            let account = linkedAccount(did: did)
            try await publicationCache(did: did, host: .leaflet).save(on: app.db)
            let content = JSONValue.object(["$type": .string("pub.leaflet.content"), "pages": .array([])])
            let lister = StubRecordLister(pages: ["site.standard.document": [
                "": ListRecordsResponse(
                    records: [documentRecord(did: did, rkey: "3lone", content: content, textContent: "One")],
                    cursor: "page-two"
                ),
                "page-two": ListRecordsResponse(
                    records: [documentRecord(did: did, rkey: "3ltwo", content: content, textContent: "Two")],
                    cursor: "terminal"
                ),
                "terminal": ListRecordsResponse(records: [], cursor: nil),
            ]])
            let request = Request(application: app, on: app.eventLoopGroup.next())

            let imported = try await PublishedPostBackfillService(records: lister)
                .backfill(account: account, req: request)
            #expect(imported.map(\.markdown) == ["One", "Two"])

            let looping = StubRecordLister(pages: ["site.standard.document": [
                "": ListRecordsResponse(
                    records: [documentRecord(did: did, rkey: "3lloop", content: content, textContent: "Loop")],
                    cursor: "loop"
                ),
                "loop": ListRecordsResponse(
                    records: [documentRecord(did: did, rkey: "3lloop", content: content, textContent: "Loop")],
                    cursor: "loop"
                ),
            ]])
            await #expect(throws: Abort.self) {
                _ = try await PublishedPostBackfillService(records: looping)
                    .backfill(account: linkedAccount(did: did), req: Request(application: app, on: app.eventLoopGroup.next()))
            }
        }
    }
}

private struct StubRecordLister: RepositoryRecordListing {
    let pages: [String: [String: ListRecordsResponse<JSONValue>]]
    var blobs: [String: Data] = [:]

    func listRecordsPage(
        account: LinkedAccount,
        collection: String,
        cursor: String?,
        client: Client
    ) async throws -> ListRecordsResponse<JSONValue> {
        guard let collectionPages = pages[collection] else {
            return ListRecordsResponse(records: [], cursor: nil)
        }
        guard let page = collectionPages[cursor ?? ""] else {
            throw Abort(.badGateway, reason: "Missing stub page")
        }
        return page
    }

    func fetchBlob(
        account: LinkedAccount,
        cid: String,
        maximumByteSize: Int,
        client: Client
    ) async throws -> Data? {
        blobs[cid]
    }
}

private func linkedAccount(did: String) -> LinkedAccount {
    LinkedAccount(
        did: did,
        handle: "writer.example",
        pdsURL: "https://pds.example",
        scope: "atproto include:site.standard.authFull",
        accessToken: "plain:access",
        refreshToken: "plain:refresh",
        tokenEndpoint: "https://pds.example/oauth/token",
        dpopKeyJSON: "plain:{}"
    )
}

private func publicationCache(did: String, host: PublicationHost) -> PublicationCache {
    PublicationCache(
        accountDID: did,
        uri: "at://\(did)/site.standard.publication/publication",
        cid: "publication-cid",
        name: "Publication",
        url: "https://publication.example",
        publicationDescription: nil,
        host: host
    )
}

private func documentRecord(
    did: String = "did:plc:writer",
    rkey: String = "3ldocument",
    content: JSONValue,
    textContent: String
) -> RepositoryRecord<JSONValue> {
    RepositoryRecord<JSONValue>(
        uri: "at://\(did)/site.standard.document/\(rkey)",
        cid: "record-cid",
        value: .object([
            "$type": .string("site.standard.document"),
            "site": .string("at://\(did)/site.standard.publication/publication"),
            "title": .string("Field notes"),
            "path": .string("/field-notes"),
            "publishedAt": .string("2026-07-06T13:00:00.000Z"),
            "content": content,
            "textContent": .string(textContent),
        ])
    )
}

private func testBlob(cid: String, mimeType: String) -> JSONValue {
    .object([
        "$type": .string("blob"),
        "ref": .object(["$link": .string(cid)]),
        "mimeType": .string(mimeType),
        "size": .integer(128),
    ])
}
