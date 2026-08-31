@testable import App
import Foundation
import Testing
import Vapor
import VaporTesting

@Suite("Research")
struct ResearchTests {
    @Test("Semble aggregation keeps current own records and applies link removals")
    func sembleAggregation() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:research-semble"
            let collectionURI = researchURI(did, "network.cosmik.collection", "ideas")
            let olderCollectionURI = researchURI(did, "network.cosmik.collection", "older")
            let urlCardURI = researchURI(did, "network.cosmik.card", "url-card")
            let noteCardURI = researchURI(did, "network.cosmik.card", "note-card")
            let removedCardURI = researchURI(did, "network.cosmik.card", "removed-card")
            let removedLinkURI = researchURI(did, "network.cosmik.collectionLink", "removed-link")
            let lister = StubResearchRecordLister(pages: [
                researchPageKey("network.cosmik.collection"): ListRecordsResponse(records: [
                    researchRecord(uri: olderCollectionURI, value: [
                        "$type": .string("network.cosmik.collection"),
                        "name": .string("Older ideas"),
                        "accessType": .string("OPEN"),
                        "createdAt": .string("2026-07-01T00:00:00Z"),
                    ]),
                    researchRecord(uri: collectionURI, value: [
                        "$type": .string("network.cosmik.collection"),
                        "name": .string("Draft ideas"),
                        "description": .string("Things to explore"),
                        "accessType": .string("CLOSED"),
                        "createdAt": .string("2026-08-01T00:00:00Z"),
                        "updatedAt": .string("2026-08-02T00:00:00Z"),
                        "ignoredExtension": .bool(true),
                    ]),
                    researchRecord(
                        uri: researchURI(did, "network.cosmik.collection", "malformed"),
                        value: ["accessType": .string("OPEN")]
                    ),
                    researchRecord(
                        uri: researchURI("did:plc:someone-else", "network.cosmik.collection", "other"),
                        value: ["name": .string("Other"), "accessType": .string("OPEN")]
                    ),
                ], cursor: nil),
                researchPageKey("network.cosmik.card"): ListRecordsResponse(records: [
                    researchRecord(uri: urlCardURI, value: [
                        "$type": .string("network.cosmik.card"),
                        "type": .string("URL"),
                        "content": .object([
                            "$type": .string("network.cosmik.card#urlContent"),
                            "url": .string("https://example.com/article"),
                            "metadata": .object([
                                "$type": .string("network.cosmik.card#urlMetadata"),
                                "title": .string("An article"),
                                "description": .string("Useful context"),
                                "siteName": .string("Example"),
                                "author": .string("A. Writer"),
                            ]),
                        ]),
                        "createdAt": .string("2026-08-03T00:00:00Z"),
                    ]),
                    researchRecord(uri: noteCardURI, value: [
                        "type": .string("NOTE"),
                        "url": .string("https://example.com/note-source"),
                        "content": .object([
                            "$type": .string("network.cosmik.card#noteContent"),
                            "text": .string("A connection worth developing"),
                        ]),
                        "createdAt": .string("2026-08-04T00:00:00Z"),
                    ]),
                    researchRecord(uri: removedCardURI, value: [
                        "type": .string("URL"),
                        "content": .object(["url": .string("https://example.com/removed")]),
                    ]),
                ], cursor: nil),
                researchPageKey("network.cosmik.collectionLink"): ListRecordsResponse(records: [
                    researchCollectionLink(
                        uri: researchURI(did, "network.cosmik.collectionLink", "url-link"),
                        collectionURI: collectionURI,
                        cardURI: urlCardURI,
                        did: did
                    ),
                    researchCollectionLink(
                        uri: researchURI(did, "network.cosmik.collectionLink", "note-link"),
                        collectionURI: collectionURI,
                        cardURI: noteCardURI,
                        did: did
                    ),
                    researchCollectionLink(
                        uri: removedLinkURI,
                        collectionURI: collectionURI,
                        cardURI: removedCardURI,
                        did: did
                    ),
                ], cursor: nil),
                researchPageKey("network.cosmik.collectionLinkRemoval"): ListRecordsResponse(records: [
                    researchRecord(
                        uri: researchURI(did, "network.cosmik.collectionLinkRemoval", "removal"),
                        value: [
                            "$type": .string("network.cosmik.collectionLinkRemoval"),
                            "collection": researchStrongRef(collectionURI),
                            "removedLink": researchStrongRef(removedLinkURI),
                            "removedAt": .string("2026-08-05T00:00:00Z"),
                        ]
                    ),
                ], cursor: nil),
            ])
            let request = Request(application: app, on: app.eventLoopGroup.next())

            let collections = try await ResearchService(records: lister).fetchSemble(
                account: researchAccount(did: did),
                req: request
            )

            let collection = try #require(collections.first)
            #expect(collections.map(\.uri) == [collectionURI, olderCollectionURI])
            #expect(collection.uri == collectionURI)
            #expect(collection.name == "Draft ideas")
            #expect(collection.description == "Things to explore")
            #expect(collection.accessType == "CLOSED")
            #expect(collection.createdAt == "2026-08-01T00:00:00Z")
            #expect(collection.updatedAt == "2026-08-02T00:00:00Z")
            #expect(collection.cards.map(\.uri) == [noteCardURI, urlCardURI])
            #expect(collection.cards[0].note == "A connection worth developing")
            #expect(collection.cards[0].url == "https://example.com/note-source")
            #expect(collection.cards[1].url == "https://example.com/article")
            #expect(collection.cards[1].title == "An article")
            #expect(collection.cards[1].description == "Useful context")
            #expect(collection.cards[1].siteName == "Example")
            #expect(collection.cards[1].author == "A. Writer")
        }
    }

    @Test("Margin aggregation maps the unified note schema and skips malformed or other-user records")
    func marginAggregation() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:research-margin"
            let uri = researchURI(did, "at.margin.note", "annotation")
            let olderURI = researchURI(did, "at.margin.note", "older")
            let lister = StubResearchRecordLister(pages: [
                researchPageKey("at.margin.note"): ListRecordsResponse(records: [
                    researchRecord(uri: olderURI, value: [
                        "motivation": .string("bookmarking"),
                        "target": .object(["source": .string("https://example.com/older")]),
                        "createdAt": .string("2026-07-01T00:00:00Z"),
                    ]),
                    researchRecord(uri: uri, value: [
                        "$type": .string("at.margin.note"),
                        "motivation": .string("highlighting"),
                        "target": .object([
                            "source": .string("https://example.com/essay"),
                            "title": .string("An essay"),
                            "selector": .object([
                                "type": .string("TextQuoteSelector"),
                                "exact": .string("A precise passage"),
                                "prefix": .string("before"),
                                "suffix": .string("after"),
                            ]),
                        ]),
                        "body": .object([
                            "value": .string("This could become a section."),
                            "format": .string("text/plain"),
                        ]),
                        "tags": .array([.string("draft"), .string("research")]),
                        "color": .string("yellow"),
                        "createdAt": .string("2026-08-06T00:00:00Z"),
                        "modifiedAt": .string("2026-08-07T00:00:00Z"),
                    ]),
                    researchRecord(
                        uri: researchURI(did, "at.margin.note", "malformed"),
                        value: ["motivation": .string("commenting")]
                    ),
                    researchRecord(
                        uri: researchURI("did:plc:someone-else", "at.margin.note", "other"),
                        value: [
                            "motivation": .string("commenting"),
                            "target": .object(["source": .string("https://other.example")]),
                            "createdAt": .string("2026-08-01T00:00:00Z"),
                        ]
                    ),
                ], cursor: nil),
            ])
            let request = Request(application: app, on: app.eventLoopGroup.next())

            let annotations = try await ResearchService(records: lister).fetchMargin(
                account: researchAccount(did: did),
                req: request
            )

            let annotation = try #require(annotations.first)
            #expect(annotations.map(\.uri) == [uri, olderURI])
            #expect(annotation.uri == uri)
            #expect(annotation.motivation == "highlighting")
            #expect(annotation.source == "https://example.com/essay")
            #expect(annotation.title == "An essay")
            #expect(annotation.body == "This could become a section.")
            #expect(annotation.quote == "A precise passage")
            #expect(annotation.tags == ["draft", "research"])
            #expect(annotation.color == "yellow")
            #expect(annotation.createdAt == "2026-08-06T00:00:00Z")
            #expect(annotation.modifiedAt == "2026-08-07T00:00:00Z")
        }
    }

    @Test("Generic paginator reads all pages and rejects cursor cycles")
    func paginationAndCycleSafety() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:research-pages"
            let first = researchRecord(
                uri: researchURI(did, "at.margin.note", "first"),
                value: ["value": .string("first")]
            )
            let second = researchRecord(
                uri: researchURI(did, "at.margin.note", "second"),
                value: ["value": .string("second")]
            )
            let lister = StubResearchRecordLister(pages: [
                researchPageKey("at.margin.note"): ListRecordsResponse(records: [first], cursor: "two"),
                researchPageKey("at.margin.note", cursor: "two"): ListRecordsResponse(records: [second], cursor: nil),
            ])

            let records = try await RepositoryRecordPaginator(records: lister).listAll(
                account: researchAccount(did: did),
                collection: "at.margin.note",
                client: app.client
            )
            #expect(records.map(\.uri) == [first.uri, second.uri])

            let cycling = StubResearchRecordLister(pages: [
                researchPageKey("network.cosmik.card"): ListRecordsResponse(records: [first], cursor: "same"),
                researchPageKey("network.cosmik.card", cursor: "same"): ListRecordsResponse(records: [second], cursor: "same"),
            ])
            await #expect(throws: (any Error).self) {
                try await RepositoryRecordPaginator(records: cycling).listAll(
                    account: researchAccount(did: did),
                    collection: "network.cosmik.card",
                    client: app.client
                )
            }
        }
    }

    @Test("Source failures are isolated and legacy Margin collections are not queried")
    func partialSourceFailure() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:research-partial"
            let marginURI = researchURI(did, "at.margin.note", "available")
            let lister = StubResearchRecordLister(
                pages: [
                    researchPageKey("at.margin.note"): ListRecordsResponse(records: [
                        researchRecord(uri: marginURI, value: [
                            "motivation": .string("bookmarking"),
                            "target": .object(["source": .string("https://available.example")]),
                            "createdAt": .string("2026-08-08T00:00:00Z"),
                        ]),
                    ], cursor: nil),
                ],
                failingCollections: ["network.cosmik.collection"]
            )
            let request = Request(application: app, on: app.eventLoopGroup.next())

            let response = await ResearchService(records: lister).load(
                account: researchAccount(did: did),
                req: request
            )

            #expect(response.semble.collections.isEmpty)
            #expect(response.semble.error != nil)
            #expect(response.margin.error == nil)
            #expect(response.margin.annotations.map(\.uri) == [marginURI])
            let requested = Set(await lister.requestedCollections())
            let currentCollections: Set<String> = [
                "network.cosmik.collection",
                "network.cosmik.collectionLink",
                "network.cosmik.collectionLinkRemoval",
                "network.cosmik.card",
                "at.margin.note",
            ]
            #expect(requested.contains("network.cosmik.collection"))
            #expect(requested.contains("at.margin.note"))
            #expect(requested.isSubset(of: currentCollections))
        }
    }

    @Test("Research endpoint requires the browser session and uses its linked account")
    func authenticatedEndpoint() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:research-endpoint"
            let cookie = try await authenticatedCookie(for: did, app: app)
            app.research = FixedResearchLoader(expectedDID: did)

            try await app.testing().test(.GET, "/api/research") { _ in
            } afterResponse: { response in
                #expect(response.status == .unauthorized)
            }

            try await app.testing().test(.GET, "/api/research") { request in
                request.headers.replaceOrAdd(name: .cookie, value: cookie)
            } afterResponse: { response in
                #expect(response.status == .ok)
                expectContent(ResearchResponse.self, response) { research in
                    #expect(research.semble.collections.first?.name == "Own research")
                    #expect(research.margin.annotations.isEmpty)
                }
            }
        }
    }
}

private actor StubResearchRecordLister: RepositoryRecordPageListing {
    let pages: [String: ListRecordsResponse<JSONValue>]
    let failingCollections: Set<String>
    private var requested: [String] = []

    init(
        pages: [String: ListRecordsResponse<JSONValue>],
        failingCollections: Set<String> = []
    ) {
        self.pages = pages
        self.failingCollections = failingCollections
    }

    func listRecordsPage(
        account: LinkedAccount,
        collection: String,
        cursor: String?,
        client: Client
    ) async throws -> ListRecordsResponse<JSONValue> {
        requested.append(collection)
        if failingCollections.contains(collection) {
            throw Abort(.badGateway, reason: "Stubbed \(collection) failure")
        }
        return pages[researchPageKey(collection, cursor: cursor)] ?? ListRecordsResponse(records: [], cursor: nil)
    }

    func requestedCollections() -> [String] { requested }
}

private struct FixedResearchLoader: ResearchLoading {
    let expectedDID: String

    func load(account: LinkedAccount, req: Request) async -> ResearchResponse {
        ResearchResponse(
            semble: SembleResearchResponse(collections: [
                SembleCollectionResponse(
                    uri: researchURI(expectedDID, "network.cosmik.collection", "own"),
                    name: account.did == expectedDID ? "Own research" : "Wrong account",
                    description: nil,
                    accessType: "CLOSED",
                    createdAt: nil,
                    updatedAt: nil,
                    cards: []
                ),
            ], error: nil),
            margin: MarginResearchResponse(annotations: [], error: nil)
        )
    }
}

private func researchAccount(did: String) -> LinkedAccount {
    LinkedAccount(
        did: did,
        handle: "researcher.example",
        pdsURL: "https://pds.example",
        scope: "atproto",
        accessToken: "plain:access",
        refreshToken: "plain:refresh"
    )
}

private func researchURI(_ did: String, _ collection: String, _ rkey: String) -> String {
    "at://\(did)/\(collection)/\(rkey)"
}

private func researchPageKey(_ collection: String, cursor: String? = nil) -> String {
    "\(collection)|\(cursor ?? "")"
}

private func researchRecord(
    uri: String,
    value: [String: JSONValue]
) -> RepositoryRecord<JSONValue> {
    RepositoryRecord(uri: uri, cid: "test-cid", value: .object(value))
}

private func researchStrongRef(_ uri: String) -> JSONValue {
    .object(["uri": .string(uri), "cid": .string("test-cid")])
}

private func researchCollectionLink(
    uri: String,
    collectionURI: String,
    cardURI: String,
    did: String
) -> RepositoryRecord<JSONValue> {
    researchRecord(uri: uri, value: [
        "$type": .string("network.cosmik.collectionLink"),
        "collection": researchStrongRef(collectionURI),
        "card": researchStrongRef(cardURI),
        "addedBy": .string(did),
        "addedAt": .string("2026-08-05T00:00:00Z"),
    ])
}
