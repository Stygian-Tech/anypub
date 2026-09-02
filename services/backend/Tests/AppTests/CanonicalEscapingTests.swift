import Testing
@testable import App

@Suite("Canonical Markdown escaping")
struct CanonicalEscapingTests {
    @Test("Imported quotes and comments preserve literal Markdown syntax")
    func literalResearchText() {
        let source = #"\[label\]\(https://example.com\) \!\[image\]\(https://example.com/image.png\) \*stars\* \\path \a"#
        let expected = #"[label](https://example.com) ![image](https://example.com/image.png) *stars* \path \a"#
        let document = CanonicalDocumentLoader.loadMarkdown("\(source)\n\n> \(source)")
        #expect(document.blocks == [
            .paragraph(RichText(plaintext: expected, spans: [])),
            .quote([RichText(plaintext: expected, spans: [])]),
        ])
    }

    @Test("Source links accept escaped punctuation in their labels and destinations")
    func escapedSourceLink() {
        let document = CanonicalDocumentLoader.loadMarkdown(#"[Source \[notes\] \*draft\*](https://example.com/notes\(1\))"#)
        let expected = "Source [notes] *draft*"
        #expect(document.blocks == [.paragraph(RichText(plaintext: expected, spans: [
            InlineSpan(byteStart: 0, byteEnd: expected.utf8.count, feature: .link("https://example.com/notes(1)")),
        ]))])
    }

    @Test("Escaped delimiters remain literal inside formatting and preserve UTF-8 facet offsets")
    func escapedStyleDelimiters() {
        let document = CanonicalDocumentLoader.loadMarkdown(#"😀 **café \*\*quoted\*\***"#)
        #expect(document.blocks == [.paragraph(RichText(plaintext: "😀 café **quoted**", spans: [
            InlineSpan(byteStart: "😀 ".utf8.count, byteEnd: "😀 café **quoted**".utf8.count, feature: .bold),
        ]))])
    }

    @Test("Code spans preserve backslashes and literal Markdown")
    func codeSpanEscapes() {
        let document = CanonicalDocumentLoader.loadMarkdown(#"`\*code\* [label](https://example.com)`"#)
        let expected = #"\*code\* [label](https://example.com)"#
        #expect(document.blocks == [.paragraph(RichText(plaintext: expected, spans: [
            InlineSpan(byteStart: 0, byteEnd: expected.utf8.count, feature: .code),
        ]))])
    }
}
