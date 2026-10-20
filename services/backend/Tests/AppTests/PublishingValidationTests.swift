@testable import App
import Foundation
import NIOCore
import Testing
import Vapor
import VaporTesting

@Suite("Publishing validation")
struct PublishingValidationTests {
    @Test("Invalid metadata fails before image lookup, uploads, and lifecycle mutation", arguments: ["title", "description", "tags"])
    func metadataPreflight(field: String) async throws {
        try await withApp(configure: configure) { app in
            let client = RejectingPublishClient(eventLoop: app.eventLoopGroup.next())
            app.clients.use { _ in client }
            let did = "did:plc:writer"
            let publicationURI = "at://\(did)/site.standard.publication/blog"
            try await LinkedAccount(
                did: did, handle: "writer.example", pdsURL: "https://pds.example",
                scope: "atproto", accessToken: "plain:access", refreshToken: "plain:refresh"
            ).save(on: app.db)
            try await PublicationCache(
                accountDID: did, uri: publicationURI, cid: nil, name: "Blog",
                url: "https://example.com", publicationDescription: nil, host: .markpub
            ).save(on: app.db)
            // A valid body that would require an uncached image and a Markdown blob upload.
            let imageID = UUID()
            let markdown = "![Body image](anypub-asset://\(imageID.uuidString))\n\n" + String(repeating: "a", count: 110_000)
            let draft = try Draft(
                accountDID: did, publicationURI: publicationURI, publicationURL: "https://example.com",
                title: field == "title" ? String(repeating: "t", count: 501) : "Title", path: "/post",
                excerpt: field == "description" ? String(repeating: "d", count: 3_001) : nil,
                tags: field == "tags" ? [String(repeating: "t", count: 129)] : [],
                markdown: markdown, status: .published, publishedAt: Date(timeIntervalSince1970: 1_800_000_000)
            )
            draft.documentURI = "at://\(did)/site.standard.document/post"
            draft.documentCID = "bafyexisting"
            try await draft.save(on: app.db)
            let draftID = try #require(draft.id)
            let originalUpdatedAt = draft.updatedAt
            do {
                _ = try await PublisherService().publish(
                    draft: draft, req: Request(application: app, on: app.eventLoopGroup.next())
                )
                Issue.record("Expected metadata rejection")
            } catch let error as Abort {
                #expect(error.status == .unprocessableEntity)
                #expect(error.reason.hasPrefix("Invalid \(field):"))
            }
            #expect(client.requestCount == 0)
            #expect(draft.typedStatus == .published)
            let saved = try #require(await Draft.find(draftID, on: app.db))
            #expect(saved.typedStatus == .published)
            #expect(saved.documentURI == draft.documentURI)
            #expect(saved.documentCID == "bafyexisting")
            #expect(saved.updatedAt == originalUpdatedAt)
        }
    }

    @Test("SDK adapter failures retain their HTTP 422 reasons")
    func adapterErrorTranslation() throws {
        let imageID = UUID()
        let document = CanonicalDocument(blocks: [.image(assetID: imageID, alt: "Image")], plaintext: "", markdown: "")
        do {
            _ = try PublicationContentAdapter.prepare(document: document, host: .leaflet)
            Issue.record("Expected missing image rejection")
        } catch let error as Abort {
            #expect(error.status == .unprocessableEntity)
            #expect(error.reason == "One or more body images are unavailable")
        }
        let image = PublishedBodyImage(
            assetID: imageID,
            blob: ATProtoBlobRef(type: "blob", ref: .init(link: "bafyimage"), mimeType: "image/png", size: 1),
            alt: "Image", width: 1, height: 1, publicURL: "https://example.com/image.png"
        )
        do {
            _ = try PublicationContentAdapter.prepare(document: document, host: .leaflet, images: [image, image])
            Issue.record("Expected duplicate image rejection")
        } catch let error as Abort {
            #expect(error.status == .unprocessableEntity)
            #expect(error.reason == "Body image IDs must be unique")
        }
        let largeDocument = CanonicalDocumentLoader.loadMarkdown(String(repeating: "a", count: 1_000_001))
        do {
            _ = try PublicationContentAdapter.prepare(document: largeDocument, host: .markpub)
            Issue.record("Expected size-limit rejection")
        } catch let error as Abort {
            #expect(error.status == .unprocessableEntity)
            #expect(error.reason == "Article exceeds Markpub's Markdown blob-size limit")
        }
    }
}

private final class RejectingPublishClient: Client, @unchecked Sendable {
    let eventLoop: any EventLoop
    private let lock = NSLock()
    private var count = 0

    init(eventLoop: any EventLoop) { self.eventLoop = eventLoop }
    var requestCount: Int { lock.withLock { count } }
    func delegating(to eventLoop: any EventLoop) -> any Client { self }
    func send(_ request: ClientRequest) -> EventLoopFuture<ClientResponse> {
        lock.withLock { count += 1 }
        return eventLoop.makeFailedFuture(Abort(.internalServerError, reason: "Unexpected network request"))
    }
}
