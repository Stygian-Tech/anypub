import Foundation

enum MarkdownPlaintext {
    static func render(_ markdown: String) -> String {
        MarkdownContentTranslator.blocks(from: markdown)
            .map(\.text)
            .joined(separator: "\n")
    }
}
