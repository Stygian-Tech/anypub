import Foundation

enum MarkdownPlaintext {
    static func render(_ markdown: String) -> String {
        CanonicalDocumentLoader.loadMarkdown(markdown).plaintext
    }
}
