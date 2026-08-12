@testable import App
import Foundation
import NIOCore
import Testing
import Vapor
import VaporTesting

@Suite("Atomic pckt publishing")
struct PcktPublishingTests {
    @Test("pckt publishing sends one authenticated applyWrites request")
    func atomicPcktWriteRequest() async throws {
        try await withApp(configure: configure) { app in
            let encryption = TokenEncryption(secret: nil)
            let account = LinkedAccount(
                did: "did:plc:writer",
                handle: "writer.example",
                pdsURL: "https://pds.example",
                scope: "atproto include:site.standard.authFull include:blog.pckt.authFull",
                accessToken: try encryption.seal("access"),
                refreshToken: try encryption.seal("refresh"),
                dpopKeyJSON: try encryption.seal(DPoPKey().exportJSON())
            )
            let capture = RequestCapture()
            let client = ApplyWritesClient(eventLoop: app.eventLoopGroup.next(), capture: capture)
            let document = StandardSiteDocumentRecord(
                site: "at://did:plc:writer/site.standard.publication/publication",
                title: "Atomic post",
                publishedAt: ATProtoTimestamp(Date(timeIntervalSince1970: 1_800_000_000)),
                path: "/atomic-post-test",
                tags: [],
                langs: ["en"],
                coverImage: nil,
                description: "Atomic post",
                textContent: "Atomic post",
                content: .object(["$type": .string("blog.pckt.content"), "items": .array([])]),
                updatedAt: ATProtoTimestamp(Date(timeIntervalSince1970: 1_800_000_000))
            )

            let result = try await ATProtoXRPCClient().applyPcktDocumentWrites(
                account: account,
                tokenEncryption: encryption,
                database: app.db,
                rkey: "3mtest",
                document: document,
                pcktPublicationURI: "at://did:plc:writer/blog.pckt.publication/publication",
                documentExists: false,
                wrapperExists: false,
                swapCommit: "bafyreirepohead",
                client: client
            )

            let request = try #require(capture.value())
            #expect(request.url.hasSuffix("/xrpc/com.atproto.repo.applyWrites"))
            #expect(request.authorization?.hasPrefix("DPoP ") == true)
            #expect(request.dpop != nil)
            let payload = try JSONDecoder().decode(JSONValue.self, from: request.body)
            let writes = try #require(payload.objectValue?["writes"]?.arrayValue)
            #expect(writes.count == 2)
            #expect(payload.objectValue?["swapCommit"] == .string("bafyreirepohead"))
            #expect(result.document.uri == "at://did:plc:writer/site.standard.document/3mtest")
            #expect(result.wrapper.uri == "at://did:plc:writer/blog.pckt.document/3mtest")
            #expect(writes[1].objectValue?["value"]?.objectValue?["document"]?.objectValue?["cid"] == .string(result.document.cid))
        }
    }

    @Test("applyWrites payload contains a same-rkey document and wrapper pair")
    func applyWritesPayload() throws {
        let document: JSONValue = .object([
            "$type": .string("site.standard.document"),
            "site": .string("at://did:plc:writer/site.standard.publication/publication"),
            "title": .string("Atomic post"),
            "publishedAt": .string("2026-08-12T12:00:00.000Z"),
        ])
        let documentCID = try ATProtoRecordCID.string(for: document)
        let wrapper: JSONValue = .object([
            "$type": .string("blog.pckt.document"),
            "document": .object([
                "uri": .string("at://did:plc:writer/site.standard.document/3mtest"),
                "cid": .string(documentCID),
            ]),
            "site": .string("at://did:plc:writer/blog.pckt.publication/publication"),
        ])
        let input = ApplyWritesInput(repo: "did:plc:writer", writes: [
            ApplyWrite(type: .create, collection: "site.standard.document", rkey: "3mtest", value: document),
            ApplyWrite(type: .create, collection: "blog.pckt.document", rkey: "3mtest", value: wrapper),
        ])
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(input))
        let writes = try #require(encoded.objectValue?["writes"]?.arrayValue)

        #expect(writes.count == 2)
        #expect(writes[0].objectValue?["$type"] == .string("com.atproto.repo.applyWrites#create"))
        #expect(writes[0].objectValue?["rkey"] == .string("3mtest"))
        #expect(writes[1].objectValue?["rkey"] == .string("3mtest"))
        #expect(writes[1].objectValue?["value"]?.objectValue?["document"]?.objectValue?["cid"] == .string(documentCID))
    }

    @Test("pckt verification validates both records and the well-known response")
    func publicationVerification() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:writer"
            let standardURI = "at://\(did)/site.standard.publication/publication"
            let standardCID = "bafyreistandard"
            let standard = RepositoryRecord(
                uri: standardURI,
                cid: standardCID,
                value: JSONValue.object([
                    "$type": .string("site.standard.publication"),
                    "name": .string("Publication"),
                    "url": .string("https://publication.example"),
                ])
            )
            let pckt = RepositoryRecord(
                uri: "at://\(did)/blog.pckt.publication/publication",
                cid: "bafyreipckt",
                value: JSONValue.object([
                    "$type": .string("blog.pckt.publication"),
                    "publication": .object([
                        "uri": .string(standardURI),
                        "cid": .string(standardCID),
                    ]),
                ])
            )
            let client = PcktVerificationClient(
                eventLoop: app.eventLoopGroup.next(),
                standardRecord: try JSONEncoder().encode(standard),
                pcktRecord: try JSONEncoder().encode(pckt),
                wellKnown: standardURI
            )

            let result = try await PcktPublicationVerifier().verify(
                standardPublicationURI: standardURI,
                account: testAccount(did: did),
                client: client
            )

            #expect(result.uri == pckt.uri)
            #expect(result.standardPublicationCID == standardCID)
            #expect(result.publicationURL == "https://publication.example")
        }
    }

    @Test("pckt verification rejects a stale strong reference")
    func stalePublicationReference() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:writer"
            let standardURI = "at://\(did)/site.standard.publication/publication"
            let standard = RepositoryRecord(
                uri: standardURI,
                cid: "bafyrenew",
                value: JSONValue.object([
                    "$type": .string("site.standard.publication"),
                    "name": .string("Publication"),
                    "url": .string("https://publication.example"),
                ])
            )
            let pckt = RepositoryRecord(
                uri: "at://\(did)/blog.pckt.publication/publication",
                cid: "bafyreipckt",
                value: JSONValue.object([
                    "$type": .string("blog.pckt.publication"),
                    "publication": .object([
                        "uri": .string(standardURI),
                        "cid": .string("bafyold"),
                    ]),
                ])
            )
            let client = PcktVerificationClient(
                eventLoop: app.eventLoopGroup.next(),
                standardRecord: try JSONEncoder().encode(standard),
                pcktRecord: try JSONEncoder().encode(pckt),
                wellKnown: standardURI
            )

            await #expect(throws: Abort.self) {
                try await PcktPublicationVerifier().verify(
                    standardPublicationURI: standardURI,
                    account: testAccount(did: did),
                    client: client
                )
            }
        }
    }

    @Test("pckt verification rejects a mismatched well-known response")
    func mismatchedWellKnown() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:writer"
            let standardURI = "at://\(did)/site.standard.publication/publication"
            let standardCID = "bafyrenew"
            let standard = RepositoryRecord(
                uri: standardURI,
                cid: standardCID,
                value: JSONValue.object([
                    "$type": .string("site.standard.publication"),
                    "name": .string("Publication"),
                    "url": .string("https://publication.example"),
                ])
            )
            let pckt = RepositoryRecord(
                uri: "at://\(did)/blog.pckt.publication/publication",
                cid: "bafyreipckt",
                value: JSONValue.object([
                    "$type": .string("blog.pckt.publication"),
                    "publication": .object([
                        "uri": .string(standardURI),
                        "cid": .string(standardCID),
                    ]),
                ])
            )
            let client = PcktVerificationClient(
                eventLoop: app.eventLoopGroup.next(),
                standardRecord: try JSONEncoder().encode(standard),
                pcktRecord: try JSONEncoder().encode(pckt),
                wellKnown: "at://did:plc:other/site.standard.publication/publication"
            )

            await #expect(throws: Abort.self) {
                try await PcktPublicationVerifier().verify(
                    standardPublicationURI: standardURI,
                    account: testAccount(did: did),
                    client: client
                )
            }
        }
    }
}

private struct CapturedRequest: Sendable {
    let url: String
    let authorization: String?
    let dpop: String?
    let body: Data
}

private final class RequestCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var request: CapturedRequest?

    func store(_ request: CapturedRequest) {
        lock.lock()
        self.request = request
        lock.unlock()
    }

    func value() -> CapturedRequest? {
        lock.lock()
        defer { lock.unlock() }
        return request
    }
}

private struct ApplyWritesClient: Client {
    let eventLoop: any EventLoop
    let capture: RequestCapture

    func delegating(to eventLoop: any EventLoop) -> any Client {
        ApplyWritesClient(eventLoop: eventLoop, capture: capture)
    }

    func send(_ request: ClientRequest) -> EventLoopFuture<ClientResponse> {
        let body = request.body.flatMap {
            $0.getData(at: $0.readerIndex, length: $0.readableBytes)
        } ?? Data()
        capture.store(CapturedRequest(
            url: request.url.string,
            authorization: request.headers.first(name: .authorization),
            dpop: request.headers.first(name: "DPoP"),
            body: body
        ))
        var responseBody = ByteBufferAllocator().buffer(capacity: 2)
        responseBody.writeString("{}")
        return eventLoop.makeSucceededFuture(ClientResponse(
            status: .ok,
            headers: ["content-type": "application/json", "DPoP-Nonce": "next-nonce"],
            body: responseBody
        ))
    }
}

private struct PcktVerificationClient: Client {
    let eventLoop: any EventLoop
    let standardRecord: Data
    let pcktRecord: Data
    let wellKnown: String

    func delegating(to eventLoop: any EventLoop) -> any Client {
        PcktVerificationClient(
            eventLoop: eventLoop,
            standardRecord: standardRecord,
            pcktRecord: pcktRecord,
            wellKnown: wellKnown
        )
    }

    func send(_ request: ClientRequest) -> EventLoopFuture<ClientResponse> {
        let url = request.url.string
        let response: (HTTPResponseStatus, String, Data)
        if url.contains("collection=site.standard.publication") {
            response = (.ok, "application/json", standardRecord)
        } else if url.contains("collection=blog.pckt.publication") {
            response = (.ok, "application/json", pcktRecord)
        } else if url == "https://publication.example/.well-known/site.standard.publication" {
            response = (.ok, "text/plain", Data(wellKnown.utf8))
        } else {
            response = (.notFound, "text/plain", Data())
        }
        var body = ByteBufferAllocator().buffer(capacity: response.2.count)
        body.writeBytes(response.2)
        return eventLoop.makeSucceededFuture(ClientResponse(
            status: response.0,
            headers: ["content-type": response.1],
            body: body
        ))
    }
}

private func testAccount(did: String) -> LinkedAccount {
    LinkedAccount(
        did: did,
        handle: "writer.example",
        pdsURL: "https://pds.example",
        scope: "atproto include:site.standard.authFull include:blog.pckt.authFull",
        accessToken: "plain:access",
        refreshToken: "plain:refresh"
    )
}
