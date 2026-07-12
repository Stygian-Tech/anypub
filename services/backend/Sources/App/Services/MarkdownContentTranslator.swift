import Foundation

enum MarkdownBlockStyle: String, Codable, Equatable, Sendable {
    case paragraph
    case heading
    case quote
    case unorderedListItem
    case orderedListItem
    case code
}

struct MarkdownContentBlock: Codable, Equatable, Sendable {
    let style: MarkdownBlockStyle
    let text: String
    let level: Int?
    let sequence: Int?
}

struct MarkdownContentTranslator: Sendable {
    static func blocks(from markdown: String) -> [MarkdownContentBlock] {
        let normalized = markdown.replacingOccurrences(of: #"\r\n?"#, with: "\n", options: .regularExpression)
        let lines = normalized.components(separatedBy: "\n")
        var blocks: [MarkdownContentBlock] = []
        var paragraph: [String] = []
        var code: [String] = []
        var inCodeFence = false
        var orderedSequence = 0

        func flushParagraph() {
            let text = paragraph.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                blocks.append(MarkdownContentBlock(style: .paragraph, text: inlineText(text), level: nil, sequence: nil))
            }
            paragraph.removeAll()
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                if inCodeFence {
                    let codeText = code.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !codeText.isEmpty {
                        blocks.append(MarkdownContentBlock(style: .code, text: codeText, level: nil, sequence: nil))
                    }
                    code.removeAll()
                    inCodeFence = false
                } else {
                    flushParagraph()
                    inCodeFence = true
                }
                continue
            }

            if inCodeFence {
                code.append(line)
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                orderedSequence = 0
                continue
            }

            if let heading = parseHeading(trimmed) {
                flushParagraph()
                blocks.append(heading)
                orderedSequence = 0
                continue
            }

            if let listItem = parseListItem(trimmed, orderedSequence: orderedSequence) {
                flushParagraph()
                if listItem.style == .orderedListItem {
                    orderedSequence = (listItem.sequence ?? orderedSequence) + 1
                }
                blocks.append(listItem)
                continue
            }

            if trimmed.hasPrefix(">") {
                flushParagraph()
                let text = trimmed.drop(while: { $0 == ">" || $0 == " " })
                blocks.append(MarkdownContentBlock(style: .quote, text: inlineText(String(text)), level: nil, sequence: nil))
                orderedSequence = 0
                continue
            }

            paragraph.append(trimmed)
        }

        flushParagraph()

        if inCodeFence {
            let codeText = code.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !codeText.isEmpty {
                blocks.append(MarkdownContentBlock(style: .code, text: codeText, level: nil, sequence: nil))
            }
        }

        return blocks.filter { !$0.text.isEmpty }
    }

    private static func parseHeading(_ line: String) -> MarkdownContentBlock? {
        let prefix = line.prefix(while: { $0 == "#" })
        guard !prefix.isEmpty,
              prefix.count <= 6,
              line.dropFirst(prefix.count).first == " "
        else { return nil }

        let text = line.dropFirst(prefix.count + 1)
        return MarkdownContentBlock(style: .heading, text: inlineText(String(text)), level: prefix.count, sequence: nil)
    }

    private static func parseListItem(_ line: String, orderedSequence: Int) -> MarkdownContentBlock? {
        if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
            return MarkdownContentBlock(style: .unorderedListItem, text: inlineText(String(line.dropFirst(2))), level: nil, sequence: nil)
        }

        guard let match = line.range(of: #"^\d+\.\s+"#, options: .regularExpression) else {
            return nil
        }

        let marker = String(line[match]).trimmingCharacters(in: .whitespaces)
        let number = Int(marker.dropLast()) ?? max(orderedSequence, 1)
        return MarkdownContentBlock(
            style: .orderedListItem,
            text: inlineText(String(line[match.upperBound...])),
            level: nil,
            sequence: number
        )
    }

    private static func inlineText(_ text: String) -> String {
        var output = text
        output = replace(pattern: #"`([^`]+)`"#, in: output, with: "$1")
        output = replace(pattern: #"!\[([^\]]*)\]\([^)]+\)"#, in: output, with: "$1")
        output = replace(pattern: #"\[([^\]]+)\]\([^)]+\)"#, in: output, with: "$1")
        output = replace(pattern: #"[~*_]"#, in: output, with: "")
        output = replace(pattern: #"[ \t]+"#, in: output, with: " ")
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func replace(pattern: String, in text: String, with replacement: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: replacement)
    }
}

