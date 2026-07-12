@testable import App
import Foundation
import Testing

@Suite("AnyPub backend logic")
struct AppLogicTests {
    @Test("OAuth scopes include standard.site, calendar, and blob upload transition")
    func oauthScopes() {
        let scopes = OAuthScopeBuilder.cmsScopes().split(separator: " ").map(String.init)
        #expect(scopes.contains("atproto"))
        #expect(scopes.contains("transition:generic"))
        #expect(scopes.contains("include:site.standard.authFull"))
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
        #expect(PublicationHostDetector.detect(themeType: "pub.leaflet.theme.publication", themeName: nil, publicationURL: nil) == .leaflet)
        #expect(PublicationHostDetector.detect(themeType: "pub.offprint.theme.publication", themeName: nil, publicationURL: nil) == .offprint)
        #expect(PublicationHostDetector.detect(themeType: "app.pckt.theme.publication", themeName: nil, publicationURL: nil) == .pckt)
        #expect(PublicationHostDetector.detect(themeType: nil, themeName: "Leaflet editorial", publicationURL: nil) == .leaflet)
        #expect(PublicationHostDetector.detect(themeType: "app.pckt.theme.publication", themeName: nil, publicationURL: "https://offprint.example") == .pckt)
    }

    @Test("Markdown content translator emits styled blocks")
    func markdownContentBlocks() {
        let markdown = """
        # Title

        Paragraph with **bold** text.

        - First item
        1. Ordered item
        > Quoted line
        """
        let blocks = MarkdownContentTranslator.blocks(from: markdown)
        #expect(blocks.map(\.style) == [.heading, .paragraph, .unorderedListItem, .orderedListItem, .quote])
        #expect(blocks[0].level == 1)
        #expect(blocks[0].text == "Title")
        #expect(blocks[1].text == "Paragraph with bold text.")
        #expect(blocks[3].sequence == 1)
    }

    @Test("Token encryption round trips in local dev mode")
    func tokenEncryptionPlainMode() throws {
        let encryption = TokenEncryption(secret: nil)
        let sealed = try encryption.seal("token-value")
        #expect(sealed.hasPrefix("plain:"))
        #expect(try encryption.open(sealed) == "token-value")
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
        #expect(record.textContent == "Launch notes\nBody")
    }

    @Test("Document record includes host-targeted content blocks when host is known")
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
        let record = ProtocolRecordBuilder().documentRecord(draft: draft, cover: nil, host: .leaflet)
        #expect(record.content?.map(\.type) == ["pub.leaflet.blocks.text", "pub.leaflet.blocks.text"])
        #expect(record.content?.map(\.style) == ["heading1", "unorderedListItem"])
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
}
