@testable import App
import Fluent
import Foundation
import Testing
import Vapor
import VaporTesting

@Suite("Publication discovery")
struct PublicationDiscoveryTests {
    @Test("Publication records decode current, legacy, generic, and extra-field shapes")
    func tolerantRecordDecoding() throws {
        let did = "did:plc:writer"
        let variants = [
            ("leaflet", "pub.leaflet.publication#theme", "https://leaflet.pub"),
            ("offprint", "app.offprint.theme", "https://offprint.example"),
            ("pckt", "blog.pckt.theme", "https://pckt.example"),
        ]

        for (rkey, themeType, url) in variants {
            let record = try publicationRecord(
                did: did,
                rkey: rkey,
                name: rkey,
                url: url,
                theme: .object([
                    "$type": .string(themeType),
                    "unknownExtension": .object(["enabled": .bool(true)]),
                ]),
                extras: ["basicTheme": .object(["$type": .string("site.standard.theme.basic")])]
            )
            let publication = try #require(DiscoveredPublication(record: record, accountDID: did))
            #expect(publication.themeType == themeType)
        }

        let legacy = try publicationRecord(
            did: did,
            rkey: "legacy",
            name: "Legacy",
            url: "https://legacy.example",
            theme: .string("at://did:plc:theme/app.offprint.theme/default")
        )
        #expect(DiscoveredPublication(record: legacy, accountDID: did)?.themeURI?.contains("app.offprint.theme") == true)

        let generic = try publicationRecord(did: did, rkey: "generic", name: "Generic", url: "https://generic.example")
        let genericPublication = try #require(DiscoveredPublication(record: generic, accountDID: did))
        #expect(genericPublication.themeType == nil)
        #expect(genericPublication.themeURI == nil)
    }

    @Test("Only the exact Blento publication rkey is excluded")
    func exactBlentoExclusion() throws {
        let did = "did:plc:writer"
        let reserved = try publicationRecord(
            did: did,
            rkey: "blento.self",
            name: "Personal page",
            url: "https://custom.example"
        )
        #expect(DiscoveredPublication(record: reserved, accountDID: did)?.isBlento == true)

        let ordinary = try publicationRecord(
            did: did,
            rkey: "ordinary",
            name: "Blento field notes",
            url: "https://blento.app/custom-looking-path"
        )
        #expect(DiscoveredPublication(record: ordinary, accountDID: did)?.isBlento == false)

        let unrelatedCollection = try repositoryRecord(
            uri: "at://\(did)/app.blento.page/blento.self",
            value: .object(publicationValue(name: "Page", url: "https://example.com"))
        )
        #expect(DiscoveredPublication(record: unrelatedCollection, accountDID: did) == nil)
    }

    @Test("Discovery paginates, skips malformed records, and reconciles only after completion")
    func paginationAndMalformedRecords() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:pagination"
            let first = try publicationRecord(did: did, rkey: "first", name: "First", url: "https://first.example")
            let blento = try publicationRecord(did: did, rkey: "blento.self", name: "Blento", url: "https://blento.app/test")
            let malformed = try repositoryRecord(
                uri: "at://\(did)/site.standard.publication/malformed",
                value: .object(["url": .string("https://missing-name.example")])
            )
            let second = try publicationRecord(did: did, rkey: "second", name: "Second", url: "https://second.example")
            let lister = StubPublicationRecordLister(pages: [
                "": ListRecordsResponse(records: [first, blento, malformed], cursor: "page-two"),
                "page-two": ListRecordsResponse(records: [second], cursor: "terminal"),
                "terminal": ListRecordsResponse(records: [], cursor: nil),
            ])
            let account = linkedAccount(did: did)
            let request = Request(application: app, on: app.eventLoopGroup.next())

            let result = try await PublicationDiscoveryService(records: lister).sync(account: account, req: request)

            #expect(result.map(\.name) == ["First", "Second"])
            #expect(try await PublicationCache.query(on: app.db).filter(\.$accountDID, .equal, did).count() == 2)
        }
    }

    @Test("Repeated cursors fail without replacing the last known cache")
    func repeatedCursorPreservesCache() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:repeat"
            try await PublicationCache(
                accountDID: did,
                uri: "at://\(did)/site.standard.publication/cached",
                cid: "old-cid",
                name: "Cached",
                url: "https://cached.example",
                publicationDescription: nil
            ).save(on: app.db)

            let record = try publicationRecord(did: did, rkey: "new", name: "New", url: "https://new.example")
            let lister = StubPublicationRecordLister(pages: [
                "": ListRecordsResponse(records: [record], cursor: "same"),
                "same": ListRecordsResponse(records: [record], cursor: "same"),
            ])
            let request = Request(application: app, on: app.eventLoopGroup.next())

            await #expect(throws: (any Error).self) {
                try await PublicationDiscoveryService(records: lister).sync(account: linkedAccount(did: did), req: request)
            }
            let cached = try await PublicationCache.query(on: app.db).filter(\.$accountDID, .equal, did).all()
            #expect(cached.map(\.name) == ["Cached"])
            #expect(cached.first?.cid == "old-cid")
        }
    }

    @Test("A failed later page leaves the last known cache untouched")
    func failedPagePreservesCache() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:failed-page"
            try await PublicationCache(
                accountDID: did,
                uri: "at://\(did)/site.standard.publication/cached",
                cid: "old-cid",
                name: "Cached",
                url: "https://cached.example",
                publicationDescription: nil
            ).save(on: app.db)

            let first = try publicationRecord(did: did, rkey: "first", name: "First", url: "https://first.example")
            let lister = StubPublicationRecordLister(
                pages: ["": ListRecordsResponse(records: [first], cursor: "failed")],
                failingCursor: "failed"
            )
            let request = Request(application: app, on: app.eventLoopGroup.next())

            await #expect(throws: (any Error).self) {
                try await PublicationDiscoveryService(records: lister).sync(account: linkedAccount(did: did), req: request)
            }
            let cached = try await PublicationCache.query(on: app.db).filter(\.$accountDID, .equal, did).all()
            #expect(cached.map(\.name) == ["Cached"])
            #expect(cached.first?.cid == "old-cid")
        }
    }

    @Test("Cache reconciliation updates, inserts, removes stale and Blento entries, and isolates accounts")
    func cacheReconciliation() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:primary"
            let otherDID = "did:plc:other"
            for cache in [
                PublicationCache(accountDID: did, uri: "at://\(did)/site.standard.publication/update", cid: "old", name: "Old name", url: "https://old.example", publicationDescription: nil),
                PublicationCache(accountDID: did, uri: "at://\(did)/site.standard.publication/stale", cid: nil, name: "Stale", url: "https://stale.example", publicationDescription: nil),
                PublicationCache(accountDID: did, uri: "at://\(did)/site.standard.publication/blento.self", cid: nil, name: "Blento", url: "https://blento.app/test", publicationDescription: nil),
                PublicationCache(accountDID: otherDID, uri: "at://\(otherDID)/site.standard.publication/keep", cid: nil, name: "Other", url: "https://other.example", publicationDescription: nil),
            ] {
                try await cache.save(on: app.db)
            }

            let updated = try #require(DiscoveredPublication(
                record: publicationRecord(
                    did: did,
                    rkey: "update",
                    name: "Updated",
                    url: "https://updated.example",
                    theme: .object(["$type": .string("app.offprint.theme")])
                ),
                accountDID: did
            ))
            let inserted = try #require(DiscoveredPublication(
                record: publicationRecord(did: did, rkey: "insert", name: "Inserted", url: "https://inserted.example"),
                accountDID: did
            ))
            let request = Request(application: app, on: app.eventLoopGroup.next())
            let result = try await PublicationDiscoveryService().reconcile(
                [updated, inserted],
                accountDID: did,
                database: app.db,
                logger: request.logger,
                syncedAt: Date(timeIntervalSince1970: 1_800_000_000)
            )

            #expect(result.map(\.name) == ["Inserted", "Updated"])
            #expect(result.first(where: { $0.name == "Updated" })?.cid == "test-cid")
            #expect(result.first(where: { $0.name == "Updated" })?.host == "offprint")
            #expect(try await PublicationCache.query(on: app.db).filter(\.$accountDID, .equal, otherDID).count() == 1)
        }
    }

    @Test("Manual sync returns the discovery result without a query parameter")
    func manualSyncContract() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:manual"
            let account = linkedAccount(did: did)
            try await account.save(on: app.db)
            app.publicationDiscovery = FixedPublicationDiscovery(accountDID: did)

            try await app.testing().test(.POST, "/api/publications/sync") { request in
                try request.content.encode(SyncPublicationsRequest(accountDID: did))
            } afterResponse: { response in
                #expect(response.status == .ok)
                expectContent([PublicationResponse].self, response) { publications in
                    #expect(publications.map(\.name) == ["Discovered"])
                }
            }
        }
    }

    @Test("OAuth discovery failure preserves the newly linked account")
    func oauthDiscoveryFailureIsNonFatal() async throws {
        try await withApp(configure: configure) { app in
            app.publicationDiscovery = FailingPublicationDiscovery()
            let request = Request(application: app, on: app.eventLoopGroup.next())
            let completion = OAuthCompletion(
                did: "did:plc:oauth",
                handle: "writer.example",
                pdsURL: "https://pds.example",
                tokenEndpoint: "https://pds.example/oauth/token",
                scope: "atproto include:site.standard.authFull",
                accessToken: "access",
                refreshToken: "refresh",
                dpopKeyJSON: "{}"
            )

            let account = try await AuthController().persistAccountAndDiscover(completion: completion, req: request)

            #expect(account.did == completion.did)
            #expect(try await LinkedAccount.query(on: app.db).filter(\.$did, .equal, completion.did).count() == 1)
        }
    }

    @Test("OAuth completion triggers publication discovery for the persisted account")
    func oauthTriggersDiscovery() async throws {
        try await withApp(configure: configure) { app in
            let discovery = RecordingPublicationDiscovery()
            app.publicationDiscovery = discovery
            let request = Request(application: app, on: app.eventLoopGroup.next())
            let completion = OAuthCompletion(
                did: "did:plc:oauth-success",
                handle: "writer.example",
                pdsURL: "https://pds.example",
                tokenEndpoint: "https://pds.example/oauth/token",
                scope: "atproto include:site.standard.authFull",
                accessToken: "access",
                refreshToken: "refresh",
                dpopKeyJSON: "{}"
            )

            _ = try await AuthController().persistAccountAndDiscover(completion: completion, req: request)

            #expect(await discovery.recordedDIDs() == [completion.did])
        }
    }
}

private struct StubPublicationRecordLister: PublicationRecordListing {
    let pages: [String: ListRecordsResponse<JSONValue>]
    var failingCursor: String?

    init(pages: [String: ListRecordsResponse<JSONValue>], failingCursor: String? = nil) {
        self.pages = pages
        self.failingCursor = failingCursor
    }

    func listPublicationRecordsPage(
        account: LinkedAccount,
        cursor: String?,
        tokenEncryption: TokenEncryption,
        database: Database,
        client: Client
    ) async throws -> ListRecordsResponse<JSONValue> {
        if let failingCursor, cursor == failingCursor {
            throw Abort(.badGateway, reason: "Stubbed page failure")
        }
        guard let page = pages[cursor ?? ""] else {
            throw Abort(.badGateway, reason: "Missing stub page")
        }
        return page
    }
}

private struct FixedPublicationDiscovery: PublicationDiscovering {
    let accountDID: String

    func sync(account: LinkedAccount, req: Request) async throws -> [PublicationCache] {
        [PublicationCache(
            accountDID: accountDID,
            uri: "at://\(accountDID)/site.standard.publication/discovered",
            cid: "cid",
            name: "Discovered",
            url: "https://discovered.example",
            publicationDescription: nil
        )]
    }
}

private struct FailingPublicationDiscovery: PublicationDiscovering {
    func sync(account: LinkedAccount, req: Request) async throws -> [PublicationCache] {
        throw Abort(.badGateway, reason: "Discovery unavailable")
    }
}

private actor RecordingPublicationDiscovery: PublicationDiscovering {
    private var dids: [String] = []

    func sync(account: LinkedAccount, req: Request) async throws -> [PublicationCache] {
        dids.append(account.did)
        return []
    }

    func recordedDIDs() -> [String] { dids }
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

private func publicationRecord(
    did: String,
    rkey: String,
    name: String,
    url: String,
    theme: JSONValue? = nil,
    extras: [String: JSONValue] = [:]
) throws -> RepositoryRecord<JSONValue> {
    var value = publicationValue(name: name, url: url)
    if let theme { value["theme"] = theme }
    for (key, extra) in extras { value[key] = extra }
    return try repositoryRecord(
        uri: "at://\(did)/site.standard.publication/\(rkey)",
        value: .object(value)
    )
}

private func publicationValue(name: String, url: String) -> [String: JSONValue] {
    [
        "$type": .string("site.standard.publication"),
        "name": .string(name),
        "url": .string(url),
        "description": .string("Description"),
    ]
}

private func repositoryRecord(uri: String, value: JSONValue) throws -> RepositoryRecord<JSONValue> {
    RepositoryRecord(uri: uri, cid: "test-cid", value: value)
}
