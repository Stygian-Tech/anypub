@testable import App
import Foundation
import Testing
import VaporTesting

@Suite("AnyPub backend logic")
struct AppLogicTests {
    @Test("pckt paths use a stable native-style discriminator")
    func pcktPathsUseStableDiscriminator() throws {
        let draftID = try #require(UUID(uuidString: "00000000-0000-0000-0000-0123456789AB"))

        #expect(pcktCompatiblePath(title: "Testing Article", path: "/testing-article", draftID: draftID) == "/testing-article-56789ab")
        #expect(pcktCompatiblePath(title: "Testing Article", path: "/my-custom-slug", draftID: draftID) == "/my-custom-slug-56789ab")
        #expect(pcktCompatiblePath(title: "Changed", path: "/custom-path-56789ab", draftID: draftID) == "/custom-path-56789ab")
    }

    @Test("OAuth scopes include standard.site, calendar, and blob upload transition")
    func oauthScopes() {
        let scopes = OAuthScopeBuilder.cmsScopes().split(separator: " ").map(String.init)
        #expect(scopes.contains("atproto"))
        #expect(scopes.contains("transition:generic"))
        #expect(scopes.contains("include:site.standard.authFull"))
        #expect(scopes.contains("include:app.offprint.authFull"))
        #expect(scopes.contains("include:blog.pckt.authFull"))
        #expect(scopes.contains("include:community.lexicon.calendar.authFull"))
    }

    @Test("Markdown renderer removes common Markdown syntax")
    func markdownPlaintext() {
        let markdown = """
        # Hello

        This is **strong** text with [a link](https://example.com).

        ![Cover alt](https://example.com/cover.jpg)
        """
        let plaintext = MarkdownPlaintext.render(markdown)
        #expect(plaintext.contains("Hello"))
        #expect(plaintext.contains("strong"))
        #expect(plaintext.contains("a link"))
        #expect(plaintext.contains("Cover alt"))
        #expect(plaintext.split(separator: "\n").count == 3)
        #expect(!plaintext.contains("https://example.com"))
    }

    @Test("Publication host detector derives deployment target from theme lexicon")
    func publicationHostDetection() {
        #expect(PublicationHostDetector.detect(themeType: "pub.leaflet.publication#theme", themeName: nil, publicationURL: nil) == .leaflet)
        #expect(PublicationHostDetector.detect(themeType: "app.offprint.theme", themeName: nil, publicationURL: nil) == .offprint)
        #expect(PublicationHostDetector.detect(themeType: "blog.pckt.theme", themeName: nil, publicationURL: nil) == .pckt)
        #expect(PublicationHostDetector.detect(themeType: nil, themeURI: "at://did:plc:test/app.offprint.theme/default", themeName: nil, publicationURL: nil) == .offprint)
        #expect(PublicationHostDetector.detect(themeType: nil, themeName: "Leaflet editorial", publicationURL: nil) == .leaflet)
        #expect(PublicationHostDetector.detect(themeType: "blog.pckt.theme", themeName: nil, publicationURL: "https://offprint.example") == .pckt)
    }

    @Test("AT record references parse repo, collection, and rkey")
    func atRecordReference() throws {
        let reference = try ATRecordReference(
            uri: "at://did:plc:example/site.standard.document/3lrecord"
        )
        #expect(reference.repo == "did:plc:example")
        #expect(reference.collection == "site.standard.document")
        #expect(reference.rkey == "3lrecord")
    }

    @Test("Canonical Markdown preserves block semantics and rich text")
    func canonicalMarkdownBlocks() {
        let markdown = """
        # Title

        Paragraph with **café 😀** and [a link](https://example.com).

        - First item
        \t- [x] Nested task

        3. Ordered item

        > Quoted line

        ```swift
        let value = 1
        ```

        ---
        """
        let document = CanonicalDocumentLoader.loadMarkdown(markdown)
        #expect(document.blocks.count == 7)
        #expect(document.plaintext.contains("café 😀"))
        guard case .paragraph(let paragraph) = document.blocks[1] else {
            Issue.record("Expected paragraph")
            return
        }
        #expect(paragraph.spans.contains { $0.feature == .bold })
        #expect(paragraph.spans.contains { $0.feature == .link("https://example.com") })
        guard case .list(let unordered) = document.blocks[2] else {
            Issue.record("Expected unordered list")
            return
        }
        #expect(unordered.items.first?.children.first?.kind == .task)
        guard case .list(let ordered) = document.blocks[3] else {
            Issue.record("Expected ordered list")
            return
        }
        #expect(ordered.start == 3)
    }

    @Test("Token encryption round trips in local dev mode")
    func tokenEncryptionPlainMode() throws {
        let encryption = TokenEncryption(secret: nil)
        #expect(!encryption.isEnabled)
        let sealed = try encryption.seal("token-value")
        #expect(sealed.hasPrefix("plain:"))
        #expect(try encryption.open(sealed) == "token-value")

        #expect(!TokenEncryption(secret: "not-valid-base64").isEnabled)
    }

    @Test("Tags encode and decode cleaned values")
    func tagsCodec() throws {
        let encoded = try TagsCodec.encode([" news ", "", "atproto"])
        #expect(try TagsCodec.decode(encoded) == ["news", "atproto"])
    }

    @Test("Document record leaves content unset and includes minimal standard.site fields")
    func documentRecord() throws {
        let draft = try Draft(
            accountDID: "did:plc:example",
            publicationURI: "at://did:plc:example/site.standard.publication/abc",
            publicationURL: "https://example.com",
            title: "Launch notes",
            path: "/launch",
            excerpt: "Short summary",
            tags: ["release"],
            markdown: "# Launch notes\n\nBody",
            status: .published,
            publishedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let record = ProtocolRecordBuilder().documentRecord(draft: draft, cover: nil)
        #expect(record.site == draft.publicationURI)
        #expect(record.title == "Launch notes")
        #expect(record.path == "/launch")
        #expect(record.tags == ["release"])
        #expect(record.langs == nil)
        #expect(record.textContent == "Launch notes\nBody")
    }

    @Test("pckt document record matches native discovery fields")
    func pcktDocumentRecordCompatibility() throws {
        let draft = try Draft(
            accountDID: "did:plc:example",
            publicationURI: "at://did:plc:example/site.standard.publication/abc",
            publicationURL: "https://example.pckt.blog",
            title: "Native pckt post",
            path: "/native-pckt-post",
            excerpt: "Summary",
            tags: [],
            markdown: "Body",
            status: .published,
            publishedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )

        let record = ProtocolRecordBuilder().documentRecord(
            draft: draft,
            cover: nil,
            content: .object(["$type": .string("blog.pckt.content"), "items": .array([])]),
            textContent: "Summary\nBody",
            pcktCompatible: true
        )
        #expect(record.tags == [])
        #expect(record.langs == ["en"])
        #expect(record.textContent == "Summary\nBody")

        let encodedRecord = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any]
        )
        #expect((encodedRecord["publishedAt"] as? String)?.hasSuffix(".000Z") == true)
        #expect((encodedRecord["updatedAt"] as? String)?.contains(".") == true)

        let wrapper = PcktDocumentRecord(
            document: StrongReference(
                uri: "at://did:plc:example/site.standard.document/record",
                cid: "bafyreiexample"
            ),
            site: "at://did:plc:example/blog.pckt.publication/abc"
        )
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(wrapper)) as? [String: Any]
        let document = encoded?["document"] as? [String: Any]
        #expect(encoded?["$type"] as? String == "blog.pckt.document")
        #expect(document?["$type"] == nil)
        #expect(document?["uri"] as? String == "at://did:plc:example/site.standard.document/record")
        #expect(document?["cid"] as? String == "bafyreiexample")
    }

    @Test("Document record includes exact Leaflet content envelope")
    func documentRecordContent() throws {
        let draft = try Draft(
            accountDID: "did:plc:example",
            publicationURI: "at://did:plc:example/site.standard.publication/abc",
            publicationURL: "https://example.com",
            title: "Styled document",
            path: "/styled",
            excerpt: nil,
            tags: [],
            markdown: "# Heading\n\n- Item",
            status: .published,
            publishedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let canonical = CanonicalDocumentLoader.loadMarkdown(draft.markdown)
        let prepared = try PublicationContentAdapter.prepare(document: canonical, host: .leaflet)
        let record = ProtocolRecordBuilder().documentRecord(draft: draft, cover: nil, content: prepared.content)
        #expect(record.content?.objectValue?["$type"] == .string("pub.leaflet.content"))
        let pages = record.content?.objectValue?["pages"]?.arrayValue
        #expect(pages?.first?.objectValue?["$type"] == .string("pub.leaflet.pages.linearDocument"))
        let blocks = pages?.first?.objectValue?["blocks"]?.arrayValue
        #expect(blocks?.first?.objectValue?["$type"] == .string("pub.leaflet.pages.linearDocument#block"))
        #expect(blocks?.first?.objectValue?["block"]?.objectValue?["$type"] == .string("pub.leaflet.blocks.header"))
    }

    @Test("Offprint adapter uses native fields and clamps headings")
    func offprintContent() throws {
        let document = CanonicalDocumentLoader.loadMarkdown("""
        ###### Deep heading

        ```swift
        let answer = 42
        ```

        - [x] Shipped
        """)
        let prepared = try PublicationContentAdapter.prepare(document: document, host: .offprint)
        let content = try #require(prepared.content.objectValue)
        #expect(content["$type"] == .string("app.offprint.content"))
        let items = try #require(content["items"]?.arrayValue)
        #expect(items[0].objectValue?["$type"] == .string("app.offprint.block.heading"))
        #expect(items[0].objectValue?["level"] == .integer(3))
        #expect(items[1].objectValue?["$type"] == .string("app.offprint.block.codeBlock"))
        #expect(items[1].objectValue?["code"] == .string("let answer = 42"))
        #expect(items[2].objectValue?["$type"] == .string("app.offprint.block.taskList"))
    }

    @Test("pckt adapter uses blog namespace, recursive lists, and extended mode")
    func pcktContent() throws {
        let document = CanonicalDocumentLoader.loadMarkdown("""
        - Parent
        \t1. Nested ordered

        Paragraph with **bold** text.
        """)
        let prepared = try PublicationContentAdapter.prepare(document: document, host: .pckt)
        let content = try #require(prepared.content.objectValue)
        #expect(content["$type"] == .string("blog.pckt.content"))
        let items = try #require(content["items"]?.arrayValue)
        #expect(items[0].objectValue?["$type"] == .string("blog.pckt.block.bulletList"))
        let firstItem = items[0].objectValue?["content"]?.arrayValue?.first
        let nestedContent = firstItem?.objectValue?["content"]?.arrayValue
        #expect(nestedContent?.last?.objectValue?["$type"] == .string("blog.pckt.block.orderedList"))

        let large = CanonicalDocumentLoader.loadMarkdown(String(repeating: "Readable paragraph. ", count: 1_500))
        let largePrepared = try PublicationContentAdapter.prepare(document: large, host: .pckt)
        guard case .pcktItems(let payload) = largePrepared.offload else {
            Issue.record("Expected pckt extended mode")
            return
        }
        #expect(payload.count > 20_000)
        #expect(largePrepared.offload?.mimeType == "application/json")
    }

    @Test("pckt content maps Markdown blocks and inline tags to native extensions")
    func pcktMarkdownMapping() throws {
        let document = CanonicalDocumentLoader.loadMarkdown("""
        ## Heading

        > Quoted **bold** text

        - [x] Finished
        - [ ] Pending

        3. Third
          - Nested

        ```swift
        let answer = 42
        ```

        ---

        **bold** *italic* `code` ~~removed~~ ++underlined++ [linked](https://example.com)
        """)
        let prepared = try PublicationContentAdapter.prepare(
            document: document,
            host: .pckt,
            description: "Article summary"
        )
        let content = try #require(prepared.content.objectValue)
        let items = try #require(content["items"]?.arrayValue)

        #expect(items.map { $0.objectValue?["$type"] } == [
            .string("blog.pckt.block.heading"),
            .string("blog.pckt.block.heading"),
            .string("blog.pckt.block.blockquote"),
            .string("blog.pckt.block.taskList"),
            .string("blog.pckt.block.orderedList"),
            .string("blog.pckt.block.codeBlock"),
            .string("blog.pckt.block.horizontalRule"),
            .string("blog.pckt.block.text"),
        ])
        #expect(items[0].objectValue?["level"] == .integer(3))
        #expect(items[0].objectValue?["plaintext"] == .string("Article summary"))
        #expect(items[1].objectValue?["level"] == .integer(2))
        #expect(items[3].objectValue?["content"]?.arrayValue?.map { $0.objectValue?["checked"] } == [.bool(true), .bool(false)])
        #expect(items[4].objectValue?["start"] == .integer(3))
        let orderedItemContent = items[4].objectValue?["content"]?.arrayValue?.first?.objectValue?["content"]?.arrayValue
        #expect(orderedItemContent?.last?.objectValue?["$type"] == .string("blog.pckt.block.bulletList"))
        #expect(items[5].objectValue?["language"] == .string("swift"))
        #expect(items[5].objectValue?["plaintext"] == .string("let answer = 42"))
        #expect(prepared.textContent.hasPrefix("Article summary\nHeading"))

        let inline = try #require(items.last?.objectValue)
        let featureTypes = inline["facets"]?.arrayValue?.compactMap {
            $0.objectValue?["features"]?.arrayValue?.first?.objectValue?["$type"]?.stringValue
        }
        #expect(featureTypes == [
            "blog.pckt.richtext.facet#bold",
            "blog.pckt.richtext.facet#italic",
            "blog.pckt.richtext.facet#code",
            "blog.pckt.richtext.facet#strikethrough",
            "blog.pckt.richtext.facet#underline",
            "blog.pckt.richtext.facet#link",
        ])
        let link = inline["facets"]?.arrayValue?.last?.objectValue?["features"]?.arrayValue?.first?.objectValue
        #expect(link?["uri"] == .string("https://example.com"))
    }

    @Test("pckt content does not duplicate a description already in the body")
    func pcktDescriptionDeduplication() throws {
        let textDocument = CanonicalDocumentLoader.loadMarkdown("Summary")
        let textPrepared = try PublicationContentAdapter.prepare(
            document: textDocument,
            host: .pckt,
            description: "Summary"
        )
        let textItems = try #require(textPrepared.content.objectValue?["items"]?.arrayValue)
        #expect(textItems.count == 1)
        #expect(textPrepared.textContent == "Summary")
    }

    @Test("pckt content mirrors the native trailing text-block envelope")
    func pcktTrailingTextBlock() throws {
        let document = CanonicalDocumentLoader.loadMarkdown("- Final item")
        let prepared = try PublicationContentAdapter.prepare(
            document: document,
            host: .pckt,
            description: "Summary"
        )
        let items = try #require(prepared.content.objectValue?["items"]?.arrayValue)
        #expect(items.first?.objectValue?["plaintext"] == .string("Summary"))
        #expect(items.last?.objectValue?["$type"] == .string("blog.pckt.block.text"))
        #expect(items.last?.objectValue?["plaintext"] == .string(""))
        #expect(prepared.textContent == "Summary\nFinal item")
    }

    @Test("Facet byte offsets are calculated from UTF-8 plaintext")
    func facetByteOffsets() throws {
        let document = CanonicalDocumentLoader.loadMarkdown("😀 **café**")
        let prepared = try PublicationContentAdapter.prepare(document: document, host: .pckt)
        let text = prepared.content.objectValue?["items"]?.arrayValue?.first?.objectValue
        #expect(text?["plaintext"] == .string("😀 café"))
        let index = text?["facets"]?.arrayValue?.first?.objectValue?["index"]?.objectValue
        #expect(index?["byteStart"] == .integer(5))
        #expect(index?["byteEnd"] == .integer(10))
    }

    @Test("Block document validation rejects divergence")
    func blockDocumentDivergence() throws {
        let snapshot = "{\"schemaVersion\":1,\"revision\":0,\"blocks\":[{\"id\":\"one\",\"kind\":\"paragraph\",\"source\":\"Different\"}],\"markdown\":\"Different\"}"
        #expect(throws: Abort.self) {
            try CanonicalDocumentLoader.validateSnapshot(
                snapshot,
                markdown: "Draft",
                expectedSchemaVersion: 1,
                expectedRevision: 0
            )
        }
    }

    @Test("DPoP proof binds method, URL, and access token")
    func dpopProof() throws {
        let proof = try DPoPKey().proof(
            httpMethod: "POST",
            url: "https://pds.example/xrpc/com.atproto.repo.createRecord",
            accessToken: "access-token",
            nonce: "server-nonce"
        )
        let parts = proof.split(separator: ".")
        #expect(parts.count == 3)
        let payload = try decodeJWTPart(String(parts[1]))
        #expect(payload["htm"] as? String == "POST")
        #expect(payload["htu"] as? String == "https://pds.example/xrpc/com.atproto.repo.createRecord")
        #expect(payload["nonce"] as? String == "server-nonce")
        #expect(payload["ath"] != nil)
    }

    @Test("Authenticated record writes reuse the OAuth nonce for the same PDS origin")
    func dpopOAuthNonceReuse() async throws {
        let did = "did:plc:dpop-nonce-reuse"
        let pdsURL = "https://pds.example"
        let nonceKey = dpopNonceKey(accountDID: did, serverURL: pdsURL)
        await dpopNonces.remove(for: nonceKey)
        await dpopNonces.set("oauth-response-nonce", for: nonceKey)

        try await withApp(configure: configure) { app in
            let encryption = TokenEncryption(secret: nil)
            let account = LinkedAccount(
                did: did,
                handle: "writer.example",
                pdsURL: pdsURL,
                scope: "atproto include:site.standard.authFull",
                accessToken: try encryption.seal("access-token"),
                refreshToken: try encryption.seal("refresh-token"),
                tokenEndpoint: "https://pds.example/oauth/token",
                dpopKeyJSON: try encryption.seal(DPoPKey().exportJSON())
            )
            let client = RecordingDPoPClient(eventLoop: app.eventLoopGroup.next())
            let record = StandardSiteDocumentRecord(
                site: "at://\(did)/site.standard.publication/test",
                title: "Nonce test",
                publishedAt: ATProtoTimestamp(Date(timeIntervalSince1970: 1_800_000_000)),
                path: "/nonce-test",
                tags: nil,
                langs: nil,
                coverImage: nil,
                description: nil,
                textContent: "Body",
                content: nil,
                updatedAt: nil
            )

            _ = try await ATProtoXRPCClient().createDocument(
                account: account,
                tokenEncryption: encryption,
                database: app.db,
                record: record,
                client: client
            )

            let proof = try #require(client.proofs().first)
            let parts = proof.split(separator: ".")
            let payload = try decodeJWTPart(String(parts[1]))
            #expect(payload["nonce"] as? String == "oauth-response-nonce")
            #expect(sameDPoPServer("https://PDS.example/oauth/token", "https://pds.example/xrpc/com.atproto.repo.createRecord"))
        }
        await dpopNonces.remove(for: nonceKey)
    }

    @Test("Calendar event links article URL and AT URI")
    func calendarRecord() throws {
        let scheduledAt = Date(timeIntervalSince1970: 1_800_000_000)
        let draft = try Draft(
            accountDID: "did:plc:example",
            publicationURI: "at://did:plc:example/site.standard.publication/abc",
            publicationURL: "https://example.com/",
            title: "Calendar post",
            path: "calendar-post",
            excerpt: nil,
            tags: [],
            markdown: "Body",
            status: .scheduled,
            scheduledAt: scheduledAt
        )
        let record = ProtocolRecordBuilder().calendarEventRecord(
            draft: draft,
            articleURI: "at://did:plc:example/site.standard.document/def"
        )
        #expect(record.name == "Calendar post")
        #expect(record.startsAt == scheduledAt)
        #expect(record.mode == "community.lexicon.calendar.event#virtual")
        #expect(record.uris.map(\.uri).contains("https://example.com/calendar-post"))
        #expect(record.uris.map(\.uri).contains("at://did:plc:example/site.standard.document/def"))
    }

    @Test("Draft API seeds, creates, and persists edits")
    func draftPersistence() async throws {
        try await withApp(configure: configure) { app in
            try await app.testing().test(.GET, "/api/drafts?accountDID=did%3Aplc%3Awriter") { response in
                #expect(response.status == .ok)
                expectContent([DraftResponse].self, response) { drafts in
                    #expect(drafts.count == 9)
                }
            }

            let create = UpsertDraftRequest(
                accountDID: "did:plc:writer",
                publicationURI: "at://did:plc:writer/site.standard.publication/3lxyz",
                publicationURL: "https://standard.example.com",
                title: "Persistent draft",
                path: "/persistent-draft",
                excerpt: "Created through the API",
                tags: ["persistence"],
                markdown: "# Original",
                coverAssetID: nil
            )
            try await app.testing().test(.POST, "/api/drafts") { request in
                try request.content.encode(create)
            } afterResponse: { response in
                #expect(response.status == .ok)
            }

            let draft = try #require(
                await Draft.query(on: app.db).filter(\.$title, .equal, "Persistent draft").first()
            )
            let draftID = try #require(draft.id)
            let update = UpsertDraftRequest(
                accountDID: create.accountDID,
                publicationURI: create.publicationURI,
                publicationURL: create.publicationURL,
                title: "Persistent draft edited",
                path: create.path,
                excerpt: create.excerpt,
                tags: create.tags,
                markdown: "# Edited\n\nSaved body",
                blockDocumentJSON: "{\"schemaVersion\":1,\"revision\":3,\"blocks\":[{\"id\":\"heading\",\"kind\":\"heading\",\"source\":\"# Edited\",\"headingLevel\":1},{\"id\":\"body\",\"kind\":\"paragraph\",\"source\":\"Saved body\"}],\"markdown\":\"# Edited\\n\\nSaved body\"}",
                blockSchemaVersion: 1,
                blockRevision: 3,
                coverAssetID: nil
            )
            try await app.testing().test(.PUT, "/api/drafts/\(draftID)") { request in
                try request.content.encode(update)
            } afterResponse: { response in
                #expect(response.status == .ok)
            }

            let persisted = try #require(await Draft.find(draftID, on: app.db))
            #expect(persisted.title == "Persistent draft edited")
            #expect(persisted.markdown == "# Edited\n\nSaved body")
            #expect(persisted.plaintext == "Edited\nSaved body")
            #expect(persisted.blockSchemaVersion == 1)
            #expect(persisted.blockRevision == 3)
            #expect(persisted.blockDocumentJSON == update.blockDocumentJSON)

            let publication = ChangeDraftPublicationRequest(
                publicationURI: "at://did:plc:writer/site.standard.publication/3labc",
                publicationURL: "https://field.example.com"
            )
            try await app.testing().test(.PATCH, "/api/drafts/\(draftID)/publication") { request in
                try request.content.encode(publication)
            } afterResponse: { response in
                #expect(response.status == .ok)
            }

            let scheduledAt = Date().addingTimeInterval(3_600)
            try await app.testing().test(.POST, "/api/drafts/\(draftID)/schedule") { request in
                try request.content.encode(ScheduleDraftRequest(scheduledAt: scheduledAt))
            } afterResponse: { response in
                #expect(response.status == .ok)
            }
            try await app.testing().test(.POST, "/api/drafts/\(draftID)/revert") { response in
                #expect(response.status == .ok)
            }

            let reverted = try #require(await Draft.find(draftID, on: app.db))
            #expect(reverted.publicationURI == publication.publicationURI)
            #expect(reverted.typedStatus == .draft)
            #expect(reverted.scheduledAt == nil)
        }
    }

    @Test("API errors retain CORS headers")
    func apiErrorsRetainCORSHeaders() async throws {
        try await withApp(configure: configure) { app in
            try await app.testing().test(.POST, "/api/drafts/00000000-0000-0000-0000-000000000000/publish") { request in
                request.headers.replaceOrAdd(name: .origin, value: "http://localhost:3000")
            } afterResponse: { response in
                #expect(response.status == .notFound)
                #expect(response.headers.first(name: .accessControlAllowOrigin) == "http://localhost:3000")
            }
        }
    }

    @Test("Published posts remain editable and unpublish all linked records")
    func editAndUnpublishPublishedPost() async throws {
        try await withApp(configure: configure) { app in
            let did = "did:plc:unpublish"
            let encryption = TokenEncryption(secret: nil)
            let client = RecordingDeletionClient(eventLoop: app.eventLoopGroup.next())
            app.clients.use { _ in client }

            let account = LinkedAccount(
                did: did,
                handle: "unpublish.example",
                pdsURL: "https://pds.example",
                scope: "atproto include:site.standard.authFull include:blog.pckt.authFull include:community.lexicon.calendar.authFull",
                accessToken: try encryption.seal("access-token"),
                refreshToken: try encryption.seal("refresh-token"),
                tokenEndpoint: "https://pds.example/oauth/token",
                dpopKeyJSON: try encryption.seal(DPoPKey().exportJSON())
            )
            try await account.save(on: app.db)

            let draft = try Draft(
                accountDID: did,
                publicationURI: "at://\(did)/site.standard.publication/publication",
                publicationURL: "https://example.pckt.blog",
                title: "Published article",
                path: "/published-article",
                excerpt: "Published summary",
                tags: [],
                markdown: "Published body",
                status: .published,
                publishedAt: Date(timeIntervalSince1970: 1_800_000_000)
            )
            draft.documentURI = "at://\(did)/site.standard.document/document"
            draft.documentCID = "bafydocument"
            draft.platformDocumentURI = "at://\(did)/blog.pckt.document/document"
            draft.platformDocumentCID = "bafywrapper"
            try await draft.save(on: app.db)
            let draftID = try #require(draft.id)
            try await CalendarEventLink(
                draftID: draftID,
                eventURI: "at://\(did)/community.lexicon.calendar.event/event",
                eventCID: "bafyevent"
            ).save(on: app.db)

            let edit = UpsertDraftRequest(
                accountDID: did,
                publicationURI: draft.publicationURI,
                publicationURL: draft.publicationURL,
                title: "Edited published article",
                path: draft.path,
                excerpt: draft.excerpt,
                tags: [],
                markdown: "Edited published body",
                coverAssetID: nil
            )
            try await app.testing().test(.PUT, "/api/drafts/\(draftID)") { request in
                try request.content.encode(edit)
            } afterResponse: { response in
                #expect(response.status == .ok)
            }
            let edited = try #require(await Draft.find(draftID, on: app.db))
            #expect(edited.typedStatus == .published)
            #expect(edited.documentURI == draft.documentURI)
            #expect(edited.title == "Edited published article")

            try await app.testing().test(.POST, "/api/drafts/\(draftID)/unpublish") { response in
                #expect(response.status == .ok)
            }

            let unpublished = try #require(await Draft.find(draftID, on: app.db))
            #expect(unpublished.typedStatus == .draft)
            #expect(unpublished.title == "Edited published article")
            #expect(unpublished.documentURI == nil)
            #expect(unpublished.documentCID == nil)
            #expect(unpublished.platformDocumentURI == nil)
            #expect(unpublished.platformDocumentCID == nil)
            #expect(unpublished.publishedAt == nil)
            #expect(try await CalendarEventLink.query(on: app.db).filter(\.$draftID, .equal, draftID).count() == 0)
            #expect(client.deletedCollections() == [
                "community.lexicon.calendar.event",
                "blog.pckt.document",
                "site.standard.document",
            ])
        }
    }

    @Test("App config separates API and web origins")
    func appConfigSeparatesAPIAndWebOrigins() {
        let config = AppConfig.load(environment: [
            "APP_PUBLIC_URL": "https://api.testing.anypub.at/",
            "WEB_PUBLIC_URL": "https://testing.anypub.at/",
            "ALLOWED_ORIGINS": "https://testing.anypub.at, https://preview.anypub.at/",
        ])

        #expect(config.publicURL == "https://api.testing.anypub.at")
        #expect(config.webPublicURL == "https://testing.anypub.at")
        #expect(config.allowedOrigins == [
            "https://testing.anypub.at",
            "https://preview.anypub.at",
        ])
    }

    @Test("OAuth metadata declares the deployed callback and DPoP profile")
    func oauthClientMetadata() {
        let config = AppConfig.load(environment: [
            "APP_PUBLIC_URL": "https://api.testing.anypub.at/",
            "WEB_PUBLIC_URL": "https://testing.anypub.at/",
        ])
        let metadata = ATProtoOAuthService().clientMetadata(config: config)

        #expect(metadata.client_id == "https://api.testing.anypub.at/oauth/client-metadata.json")
        #expect(metadata.redirect_uris == ["https://api.testing.anypub.at/api/auth/atproto/callback"])
        #expect(metadata.grant_types.contains("authorization_code"))
        #expect(metadata.grant_types.contains("refresh_token"))
        #expect(metadata.dpop_bound_access_tokens)
        #expect(metadata.scope.split(separator: " ").contains("atproto"))
    }

    @Test("OAuth discovery decodes JSON independently of its HTTP media type")
    func oauthDiscoveryJSONDecoding() throws {
        var body = ByteBuffer()
        body.writeString("""
        {"access_token":"access","refresh_token":"refresh","token_type":"DPoP","scope":"atproto","sub":"did:plc:test"}
        """)

        let token = try decodeJSONBody(OAuthTokenResponse.self, from: body)
        #expect(token.accessToken == "access")
        #expect(token.subject == "did:plc:test")
    }

    @Test("Scheduled publisher executes due drafts and records failures")
    func scheduledPublisherRuns() async throws {
        try await withApp(configure: configure) { app in
            let due = try Draft(
                accountDID: "did:plc:missing-account",
                publicationURI: "at://did:plc:missing-account/site.standard.publication/test",
                publicationURL: "https://example.com",
                title: "Due draft",
                path: "/due",
                excerpt: nil,
                tags: [],
                markdown: "Ready to publish",
                status: .scheduled,
                scheduledAt: Date().addingTimeInterval(-60)
            )
            try await due.save(on: app.db)

            let request = Request(application: app, on: app.eventLoopGroup.next())
            let run = try await ScheduledPublisher().run(req: request)

            #expect(run.publishedCount == 0)
            #expect(run.failedCount == 1)
            #expect(try await SchedulerRun.query(on: app.db).count() == 1)
        }
    }
}

private final class RecordingDPoPClient: Client, @unchecked Sendable {
    let eventLoop: any EventLoop
    private let lock = NSLock()
    private var recordedProofs: [String] = []

    init(eventLoop: any EventLoop) {
        self.eventLoop = eventLoop
    }

    func delegating(to eventLoop: any EventLoop) -> any Client {
        self
    }

    func send(_ request: ClientRequest) -> EventLoopFuture<ClientResponse> {
        guard request.method == .POST,
              let proof = request.headers.first(name: "DPoP")
        else {
            return eventLoop.makeFailedFuture(RecordingDPoPClientError.invalidRequest)
        }
        lock.lock()
        recordedProofs.append(proof)
        lock.unlock()

        var body = ByteBuffer()
        body.writeString("""
        {"uri":"at://did:plc:dpop-nonce-reuse/site.standard.document/3mtest","cid":"bafytest"}
        """)
        return eventLoop.makeSucceededFuture(ClientResponse(
            status: .ok,
            headers: [
                "content-type": "application/json",
                "DPoP-Nonce": "next-resource-nonce",
            ],
            body: body
        ))
    }

    func proofs() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return recordedProofs
    }
}

private final class RecordingDeletionClient: Client, @unchecked Sendable {
    let eventLoop: any EventLoop
    private let lock = NSLock()
    private var collections: [String] = []

    init(eventLoop: any EventLoop) {
        self.eventLoop = eventLoop
    }

    func delegating(to eventLoop: any EventLoop) -> any Client {
        self
    }

    func send(_ request: ClientRequest) -> EventLoopFuture<ClientResponse> {
        guard request.method == .POST,
              request.url.string.contains("com.atproto.repo.deleteRecord"),
              let body = request.body,
              let json = body.getString(at: body.readerIndex, length: body.readableBytes),
              let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let collection = object["collection"] as? String
        else {
            return eventLoop.makeFailedFuture(RecordingDPoPClientError.invalidRequest)
        }
        lock.lock()
        collections.append(collection)
        lock.unlock()
        return eventLoop.makeSucceededFuture(ClientResponse(
            status: .ok,
            headers: ["DPoP-Nonce": "deletion-nonce"]
        ))
    }

    func deletedCollections() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return collections
    }
}

private enum RecordingDPoPClientError: Error {
    case invalidRequest
}

private func decodeJWTPart(_ value: String) throws -> [String: Any] {
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    let data = try #require(Data(base64Encoded: base64))
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}
