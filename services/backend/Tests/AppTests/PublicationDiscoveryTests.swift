@testable import App
import Fluent
import Foundation
import Testing
import Vapor
import VaporTesting

@Suite("Publication discovery")
struct PublicationDiscoveryTests {
    @Test("Account profile lookup uses the public PDS endpoint without DPoP")
    func publicAccountProfileLookup() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:public-profile"
            let record = try repositoryRecord(
                uri: "at://\(did)/app.bsky.actor.profile/self",
                value: .object([
                    "displayName": .string("Public Writer"),
                    "avatar": testBlob(cid: "avatar-cid"),
                ])
            )
            let payload = try JSONEncoder().encode(record)
            let client = PublicPublicationClient(eventLoop: app.eventLoopGroup.next(), responseBody: payload)

            let response = try await ATProtoXRPCClient().getAccountProfileRecord(
                account: linkedAccount(did: did),
                client: client
            )

            #expect(response?.value.objectValue?["displayName"]?.stringValue == "Public Writer")
            #expect(response?.value.objectValue?["avatar"]?.blobCID == "avatar-cid")
        }
    }

    @Test("Publication listing uses the public PDS endpoint without DPoP")
    func publicPublicationListing() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:public-listing"
            let record = try publicationRecord(
                did: did,
                rkey: "publication",
                name: "Public publication",
                url: "https://publication.example"
            )
            let payload = try JSONEncoder().encode(ListRecordsResponse(records: [record], cursor: "next"))
            let client = PublicPublicationClient(
                eventLoop: app.eventLoopGroup.next(),
                responseBody: payload
            )
            let account = LinkedAccount(
                did: did,
                handle: "writer.example",
                pdsURL: "https://pds.example",
                scope: "atproto",
                accessToken: "not-needed",
                refreshToken: "not-needed"
            )

            let response = try await ATProtoXRPCClient().listPublicationRecordsPage(
                account: account,
                cursor: "before",
                client: client
            )

            #expect(response.records.map(\.uri) == [record.uri])
            #expect(response.cursor == "next")
        }
    }

    @Test("pckt publication verification uses the public PDS endpoint without DPoP")
    func publicPcktPublicationVerification() async throws {
        try await withApp(configure: configure) { app in
            let client = PublicPublicationClient(
                eventLoop: app.eventLoopGroup.next(),
                responseBody: Data()
            )

            let exists = try await ATProtoXRPCClient().recordExists(
                account: linkedAccount(did: "did:plc:pckt-public"),
                collection: "blog.pckt.publication",
                rkey: "publication",
                client: client
            )

            #expect(exists)
        }
    }

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

        let withIcon = try publicationRecord(
            did: did,
            rkey: "icon",
            name: "Icon",
            url: "https://icon.example",
            extras: ["icon": testBlob(cid: "publication-icon-cid")]
        )
        #expect(DiscoveredPublication(record: withIcon, accountDID: did)?.iconCID == "publication-icon-cid")
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
                    theme: .object(["$type": .string("app.offprint.theme")]),
                    extras: ["icon": testBlob(cid: "updated-icon-cid")]
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
            #expect(result.first(where: { $0.name == "Inserted" })?.host == "unknown")
            #expect(result.first(where: { $0.name == "Updated" })?.cid == "test-cid")
            #expect(result.first(where: { $0.name == "Updated" })?.host == "offprint")
            #expect(result.first(where: { $0.name == "Updated" })?.iconCID == "updated-icon-cid")
            #expect(try await PublicationCache.query(on: app.db).filter(\.$accountDID, .equal, otherDID).count() == 1)
        }
    }

    @Test("Manual sync returns the discovery result without a query parameter")
    func manualSyncContract() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:manual"
            let account = linkedAccount(did: did)
            try await account.save(on: app.db)
            let cookie = try await authenticatedCookie(for: did, app: app)
            app.publicationDiscovery = FixedPublicationDiscovery(accountDID: did)

            try await app.testing().test(.POST, "/api/publications/sync") { request in
                request.headers.replaceOrAdd(name: .cookie, value: cookie)
                try request.content.encode(SyncPublicationsRequest(accountDID: did))
            } afterResponse: { response in
                #expect(response.status == .ok)
                expectContent([PublicationResponse].self, response) { publications in
                    #expect(publications.map(\.name) == ["Discovered"])
                    #expect(publications.first?.iconURL == "https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:manual&cid=publication-icon-cid")
                }
            }
        }
    }

    @Test("Account listing refreshes and returns the display name and avatar URL")
    func accountIdentityContract() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:identity"
            try await linkedAccount(did: did).save(on: app.db)
            let cookie = try await authenticatedCookie(for: did, app: app)
            app.accountProfileDiscovery = FixedAccountProfileDiscovery(
                displayName: "Sam Writer",
                avatarCID: "avatar-cid"
            )

            try await app.testing().test(.GET, "/api/accounts") { request in
                request.headers.replaceOrAdd(name: .cookie, value: cookie)
            } afterResponse: { response in
                #expect(response.status == .ok)
                expectContent([AccountResponse].self, response) { accounts in
                    #expect(accounts.first?.displayName == "Sam Writer")
                    #expect(accounts.first?.avatarURL == "https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:identity&cid=avatar-cid")
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

private struct PublicPublicationClient: Client {
    let eventLoop: any EventLoop
    let responseBody: Data

    func delegating(to eventLoop: any EventLoop) -> any Client {
        PublicPublicationClient(eventLoop: eventLoop, responseBody: responseBody)
    }

    func send(_ request: ClientRequest) -> EventLoopFuture<ClientResponse> {
        guard request.method == .GET,
              request.headers.first(name: .authorization) == nil,
              request.headers.first(name: "DPoP") == nil
        else {
            return eventLoop.makeFailedFuture(UnexpectedAuthenticatedPublicationRequest())
        }

        var body = byteBufferAllocator.buffer(capacity: responseBody.count)
        body.writeBytes(responseBody)
        return eventLoop.makeSucceededFuture(ClientResponse(
            status: .ok,
            headers: ["content-type": "application/json"],
            body: body
        ))
    }
}

private struct UnexpectedAuthenticatedPublicationRequest: Error {}

private struct FixedPublicationDiscovery: PublicationDiscovering {
    let accountDID: String

    func sync(account: LinkedAccount, req: Request) async throws -> [PublicationCache] {
        [PublicationCache(
            accountDID: accountDID,
            uri: "at://\(accountDID)/site.standard.publication/discovered",
            cid: "cid",
            name: "Discovered",
            url: "https://discovered.example",
            publicationDescription: nil,
            iconCID: "publication-icon-cid"
        )]
    }
}

private struct FixedAccountProfileDiscovery: AccountProfileDiscovering {
    let displayName: String
    let avatarCID: String

    func sync(account: LinkedAccount, req: Request) async throws {
        account.displayName = displayName
        account.avatarCID = avatarCID
        try await account.save(on: req.db)
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

private func testBlob(cid: String) -> JSONValue {
    .object([
        "$type": .string("blob"),
        "ref": .object(["$link": .string(cid)]),
        "mimeType": .string("image/png"),
        "size": .integer(128),
    ])
}

private func repositoryRecord(uri: String, value: JSONValue) throws -> RepositoryRecord<JSONValue> {
    RepositoryRecord(uri: uri, cid: "test-cid", value: value)
}
