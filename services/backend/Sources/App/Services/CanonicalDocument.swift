import Foundation
import Vapor

enum InlineFeature: Equatable, Sendable {
    case bold
    case italic
    case code
    case strikethrough
    case underline
    case link(String)
}

struct InlineSpan: Equatable, Sendable {
    let byteStart: Int
    let byteEnd: Int
    let feature: InlineFeature
}

struct RichText: Equatable, Sendable {
    let plaintext: String
    let spans: [InlineSpan]
}

enum CanonicalListKind: Equatable, Sendable {
    case unordered
    case ordered
    case task
}

struct CanonicalListItem: Equatable, Sendable {
    let content: RichText
    let checked: Bool?
    var children: [CanonicalList]
}

struct CanonicalList: Equatable, Sendable {
    let kind: CanonicalListKind
    let start: Int?
    var items: [CanonicalListItem]
}

enum CanonicalBlock: Equatable, Sendable {
    case paragraph(RichText)
    case heading(level: Int, content: RichText)
    case quote([RichText])
    case list(CanonicalList)
    case code(language: String?, source: String)
    case image(assetID: UUID, alt: String)
    case embed(url: String)
    case thematicBreak
}

struct CanonicalDocument: Equatable, Sendable {
    let blocks: [CanonicalBlock]
    let plaintext: String
    let markdown: String
}

private struct BlockDocumentSnapshot: Decodable {
    let schemaVersion: Int
    let revision: Int
    let blocks: [BlockDocumentBlock]
    let markdown: String
}

private struct BlockDocumentBlock: Decodable {
    let id: String
    let kind: String
    let source: String
    let headingLevel: Int?
    let listLevel: Int?
    let listStart: Int?
    let language: String?
}

private struct FlatListRow {
    let kind: CanonicalListKind
    let level: Int
    let start: Int?
    let checked: Bool?
    let content: RichText
}

enum CanonicalDocumentLoader {
    static func load(draft: Draft) throws -> CanonicalDocument {
        if let snapshotJSON = draft.blockDocumentJSON {
            return try loadSnapshot(
                snapshotJSON,
                markdown: draft.markdown,
                expectedSchemaVersion: draft.blockSchemaVersion,
                expectedRevision: draft.blockRevision
            )
        }
        return loadMarkdown(draft.markdown)
    }

    static func validateSnapshot(
        _ snapshotJSON: String?,
        markdown: String,
        expectedSchemaVersion: Int?,
        expectedRevision: Int?
    ) throws {
        guard let snapshotJSON else { return }
        _ = try loadSnapshot(
            snapshotJSON,
            markdown: markdown,
            expectedSchemaVersion: expectedSchemaVersion,
            expectedRevision: expectedRevision
        )
    }

    static func loadMarkdown(_ markdown: String) -> CanonicalDocument {
        let normalized = normalize(markdown)
        let sources = splitSources(normalized)
        let blocks = canonicalBlocks(from: sources.map(inferBlock))
        return CanonicalDocument(blocks: blocks, plaintext: plaintext(from: blocks), markdown: normalized)
    }

    private static func loadSnapshot(
        _ snapshotJSON: String,
        markdown: String,
        expectedSchemaVersion: Int?,
        expectedRevision: Int?
    ) throws -> CanonicalDocument {
        guard let data = snapshotJSON.data(using: .utf8) else {
            throw Abort(.unprocessableEntity, reason: "Block document snapshot is not UTF-8")
        }
        let snapshot: BlockDocumentSnapshot
        do {
            snapshot = try JSONDecoder().decode(BlockDocumentSnapshot.self, from: data)
        } catch {
            throw Abort(.unprocessableEntity, reason: "Block document snapshot is invalid")
        }
        guard snapshot.schemaVersion == 1,
              expectedSchemaVersion.map({ $0 == snapshot.schemaVersion }) ?? true
        else {
            throw Abort(.unprocessableEntity, reason: "Unsupported block document schema version")
        }
        guard snapshot.revision >= 0,
              expectedRevision.map({ $0 == snapshot.revision }) ?? true
        else {
            throw Abort(.unprocessableEntity, reason: "Block document revision does not match the draft")
        }
        guard snapshot.markdown == markdown else {
            throw Abort(.unprocessableEntity, reason: "Block document Markdown does not match the draft")
        }
        let ids = snapshot.blocks.map(\.id)
        guard ids.allSatisfy({ !$0.isEmpty }), Set(ids).count == ids.count else {
            throw Abort(.unprocessableEntity, reason: "Block document IDs must be non-empty and unique")
        }
        let kinds = Set(["empty", "heading", "thematic-break", "quote", "unordered-list", "ordered-list", "code", "image", "embed", "paragraph"])
        guard snapshot.blocks.allSatisfy({ block in
            guard kinds.contains(block.kind) else { return false }
            switch block.kind {
            case "heading": return (1...6).contains(block.headingLevel ?? 0)
            case "unordered-list": return (0...4).contains(block.listLevel ?? -1)
            case "ordered-list": return (0...4).contains(block.listLevel ?? -1) && (block.listStart ?? 0) >= 1
            case "image": return parseImageSource(block.source) != nil
            case "embed": return parseEmbedSource(block.source) != nil
            default: return true
            }
        }) else {
            throw Abort(.unprocessableEntity, reason: "Block document contains invalid block metadata")
        }
        guard reconstructMarkdown(snapshot.blocks) == snapshot.markdown else {
            throw Abort(.unprocessableEntity, reason: "Block document Markdown does not match its blocks")
        }
        let blocks = canonicalBlocks(from: snapshot.blocks)
        return CanonicalDocument(blocks: blocks, plaintext: plaintext(from: blocks), markdown: markdown)
    }

    private static func canonicalBlocks(from sourceBlocks: [BlockDocumentBlock]) -> [CanonicalBlock] {
        var result: [CanonicalBlock] = []
        var rows: [FlatListRow] = []

        func flushLists() {
            guard !rows.isEmpty else { return }
            var index = 0
            while index < rows.count {
                result.append(.list(parseList(rows, index: &index, level: rows[index].level)))
            }
            rows.removeAll()
        }

        for block in sourceBlocks {
            switch block.kind {
            case "empty":
                continue
            case "unordered-list", "ordered-list":
                let parsed = listRow(block)
                rows.append(parsed)
            default:
                flushLists()
                switch block.kind {
                case "heading":
                    let level = max(1, min(6, block.headingLevel ?? headingLevel(block.source)))
                    result.append(.heading(level: level, content: InlineMarkdown.parse(stripHeading(block.source))))
                case "thematic-break":
                    result.append(.thematicBreak)
                case "quote":
                    let lines = block.source.components(separatedBy: "\n").map {
                        InlineMarkdown.parse($0.replacingOccurrences(of: #"^\s{0,3}>\s?"#, with: "", options: .regularExpression))
                    }
                    result.append(.quote(lines))
                case "code":
                    result.append(.code(language: block.language, source: stripCodeFence(block.source)))
                case "image":
                    if let image = parseImageSource(block.source) {
                        result.append(.image(assetID: image.assetID, alt: image.alt))
                    }
                case "embed":
                    if let url = parseEmbedSource(block.source) {
                        result.append(.embed(url: url))
                    }
                default:
                    result.append(.paragraph(InlineMarkdown.parse(block.source.replacingOccurrences(of: "\n", with: " "))))
                }
            }
        }
        flushLists()
        return result
    }

    private static func listRow(_ block: BlockDocumentBlock) -> FlatListRow {
        let source = block.source
        let unordered = block.kind == "unordered-list"
        let markerPattern = unordered ? #"^[ \t]*[-*+]\s*"# : #"^[ \t]*\d+\.\s*"#
        var text = source.replacingOccurrences(of: markerPattern, with: "", options: .regularExpression)
        var checked: Bool?
        if unordered, let match = text.range(of: #"^\[[ xX]\]\s*"#, options: .regularExpression) {
            checked = text[match].lowercased().contains("x")
            text.removeSubrange(match)
        }
        return FlatListRow(
            kind: checked == nil ? (unordered ? .unordered : .ordered) : .task,
            level: max(0, block.listLevel ?? inferredListLevel(source)),
            start: unordered ? nil : max(1, block.listStart ?? inferredListStart(source)),
            checked: checked,
            content: InlineMarkdown.parse(text.replacingOccurrences(of: "\n", with: " "))
        )
    }

    private static func parseList(_ rows: [FlatListRow], index: inout Int, level: Int) -> CanonicalList {
        let kind = rows[index].kind
        let start = rows[index].start
        var items: [CanonicalListItem] = []

        while index < rows.count {
            let row = rows[index]
            if row.level < level || row.level == level && row.kind != kind { break }
            if row.level > level {
                guard !items.isEmpty else {
                    index += 1
                    continue
                }
                let child = parseList(rows, index: &index, level: row.level)
                items[items.count - 1].children.append(child)
                continue
            }
            items.append(CanonicalListItem(content: row.content, checked: row.checked, children: []))
            index += 1
            while index < rows.count, rows[index].level > level {
                let childLevel = rows[index].level
                items[items.count - 1].children.append(parseList(rows, index: &index, level: childLevel))
            }
        }
        return CanonicalList(kind: kind, start: start, items: items)
    }

    private static func plaintext(from blocks: [CanonicalBlock]) -> String {
        blocks.flatMap { block -> [String] in
            switch block {
            case .paragraph(let text), .heading(_, let text): return [text.plaintext]
            case .quote(let lines): return lines.map(\.plaintext)
            case .list(let list): return listPlaintext(list)
            case .code(_, let source): return [source]
            case .image(_, let alt): return alt.isEmpty ? [] : [alt]
            case .embed(let url): return [url]
            case .thematicBreak: return []
            }
        }.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    private static func listPlaintext(_ list: CanonicalList) -> [String] {
        list.items.flatMap { [$0.content.plaintext] + $0.children.flatMap(listPlaintext) }
    }

    private static func reconstructMarkdown(_ blocks: [BlockDocumentBlock]) -> String {
        var output = ""
        var previousKind: String?
        for block in blocks where !block.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let source = block.kind == "unordered-list" || block.kind == "ordered-list"
                ? block.source.trimmingCharacters(in: .newlines)
                : block.source.trimmingCharacters(in: .whitespacesAndNewlines)
            let separator = previousKind == block.kind && (block.kind == "unordered-list" || block.kind == "ordered-list") ? "\n" : output.isEmpty ? "" : "\n\n"
            output += separator + source
            previousKind = block.kind
        }
        return output
    }

    private static func normalize(_ markdown: String) -> String {
        markdown.replacingOccurrences(of: #"\r\n?"#, with: "\n", options: .regularExpression)
            .trimmingCharacters(in: .newlines)
    }

    private static func splitSources(_ markdown: String) -> [String] {
        guard !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        return markdown.components(separatedBy: try! NSRegularExpression(pattern: #"\n{2,}"#))
            .flatMap(splitListItems)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private static func splitListItems(_ source: String) -> [String] {
        let lines = source.components(separatedBy: "\n")
        guard lines.first.map(isListLine) == true else { return [source] }
        var result: [String] = []
        var current: [String] = []
        for line in lines {
            if isListLine(line), !current.isEmpty {
                result.append(current.joined(separator: "\n"))
                current.removeAll()
            }
            current.append(line.trimmingCharacters(in: .newlines))
        }
        if !current.isEmpty { result.append(current.joined(separator: "\n")) }
        return result
    }

    private static func inferBlock(_ source: String) -> BlockDocumentBlock {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.range(of: #"^```"#, options: .regularExpression) != nil {
            let language = trimmed.components(separatedBy: "\n").first?.dropFirst(3)
            return .init(id: UUID().uuidString, kind: "code", source: source, headingLevel: nil, listLevel: nil, listStart: nil, language: language.flatMap { $0.isEmpty ? nil : String($0) })
        }
        if parseImageSource(trimmed) != nil {
            return .init(id: UUID().uuidString, kind: "image", source: source, headingLevel: nil, listLevel: nil, listStart: nil, language: nil)
        }
        if parseEmbedSource(trimmed) != nil {
            return .init(id: UUID().uuidString, kind: "embed", source: source, headingLevel: nil, listLevel: nil, listStart: nil, language: nil)
        }
        if trimmed.range(of: #"^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$"#, options: .regularExpression) != nil {
            return .init(id: UUID().uuidString, kind: "thematic-break", source: source, headingLevel: nil, listLevel: nil, listStart: nil, language: nil)
        }
        if trimmed.range(of: #"^#{1,6}\s+"#, options: .regularExpression) != nil {
            return .init(id: UUID().uuidString, kind: "heading", source: source, headingLevel: headingLevel(source), listLevel: nil, listStart: nil, language: nil)
        }
        if source.components(separatedBy: "\n").allSatisfy({ $0.range(of: #"^\s{0,3}>\s?"#, options: .regularExpression) != nil }) {
            return .init(id: UUID().uuidString, kind: "quote", source: source, headingLevel: nil, listLevel: nil, listStart: nil, language: nil)
        }
        if source.range(of: #"^[ \t]*[-*+](?:\s+|$)"#, options: .regularExpression) != nil {
            return .init(id: UUID().uuidString, kind: "unordered-list", source: source, headingLevel: nil, listLevel: inferredListLevel(source), listStart: nil, language: nil)
        }
        if source.range(of: #"^[ \t]*\d+\.(?:\s+|$)"#, options: .regularExpression) != nil {
            return .init(id: UUID().uuidString, kind: "ordered-list", source: source, headingLevel: nil, listLevel: inferredListLevel(source), listStart: inferredListStart(source), language: nil)
        }
        return .init(id: UUID().uuidString, kind: "paragraph", source: source, headingLevel: nil, listLevel: nil, listStart: nil, language: nil)
    }

    private static func headingLevel(_ source: String) -> Int {
        source.trimmingCharacters(in: .whitespacesAndNewlines).prefix(while: { $0 == "#" }).count
    }

    private static func stripHeading(_ source: String) -> String {
        source.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"^#{1,6}\s+"#, with: "", options: .regularExpression)
    }

    private static func stripCodeFence(_ source: String) -> String {
        var lines = source.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")
        if lines.first?.hasPrefix("```") == true { lines.removeFirst() }
        if lines.last?.trimmingCharacters(in: .whitespaces) == "```" { lines.removeLast() }
        return lines.joined(separator: "\n")
    }

    private static func inferredListLevel(_ source: String) -> Int {
        let prefix = source.prefix(while: { $0 == " " || $0 == "\t" })
        return prefix.filter { $0 == "\t" }.count + prefix.filter { $0 == " " }.count / 2
    }

    private static func inferredListStart(_ source: String) -> Int {
        let trimmed = source.trimmingCharacters(in: .whitespaces)
        return Int(trimmed.prefix(while: \.isNumber)) ?? 1
    }

    private static func isListLine(_ line: String) -> Bool {
        line.range(of: #"^[ \t]*(?:[-*+]|\d+\.)(?:\s+|$)"#, options: .regularExpression) != nil
    }

    private static func parseImageSource(_ source: String) -> (assetID: UUID, alt: String)? {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("!["), trimmed.hasSuffix(")"),
              let separator = trimmed.range(of: "](anypub-asset://")
        else { return nil }
        let alt = String(trimmed[trimmed.index(trimmed.startIndex, offsetBy: 2)..<separator.lowerBound])
        let idStart = separator.upperBound
        let idEnd = trimmed.index(before: trimmed.endIndex)
        guard let assetID = UUID(uuidString: String(trimmed[idStart..<idEnd])) else { return nil }
        return (assetID, alt)
    }

    private static func parseEmbedSource(_ source: String) -> String? {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "@[embed]("
        guard trimmed.hasPrefix(prefix), trimmed.hasSuffix(")") else { return nil }
        let value = String(trimmed.dropFirst(prefix.count).dropLast())
        guard let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host != nil
        else { return nil }
        return value
    }
}

private enum InlineMarkdown {
    static func parse(_ markdown: String) -> RichText {
        var parser = Parser(markdown)
        parser.parse()
        return RichText(plaintext: parser.output, spans: parser.spans.sorted {
            if $0.byteStart == $1.byteStart { return $0.byteEnd > $1.byteEnd }
            return $0.byteStart < $1.byteStart
        })
    }

    private struct Parser {
        let source: String
        var index: String.Index
        var output = ""
        var spans: [InlineSpan] = []

        init(_ source: String) {
            self.source = source
            self.index = source.startIndex
        }

        mutating func parse(until delimiter: String? = nil) {
            while index < source.endIndex {
                if let delimiter, source[index...].hasPrefix(delimiter) {
                    index = source.index(index, offsetBy: delimiter.count)
                    return
                }
                if consumeLink(image: true) || consumeLink(image: false) { continue }
                if consumeDelimited("**", feature: .bold) || consumeDelimited("__", feature: .bold) || consumeDelimited("~~", feature: .strikethrough) || consumeDelimited("++", feature: .underline) || consumeDelimited("`", feature: .code) || consumeDelimited("*", feature: .italic) || consumeDelimited("_", feature: .italic) { continue }
                output.append(source[index])
                index = source.index(after: index)
            }
        }

        mutating func consumeDelimited(_ delimiter: String, feature: InlineFeature) -> Bool {
            guard source[index...].hasPrefix(delimiter) else { return false }
            let contentStart = source.index(index, offsetBy: delimiter.count)
            guard let close = source.range(of: delimiter, range: contentStart..<source.endIndex)?.lowerBound else { return false }
            index = contentStart
            let start = output.utf8.count
            let savedEnd = close
            let inner = String(source[index..<savedEnd])
            var child = Parser(inner)
            child.parse()
            output += child.output
            spans += child.spans.map { InlineSpan(byteStart: start + $0.byteStart, byteEnd: start + $0.byteEnd, feature: $0.feature) }
            let end = output.utf8.count
            if end > start { spans.append(InlineSpan(byteStart: start, byteEnd: end, feature: feature)) }
            index = source.index(savedEnd, offsetBy: delimiter.count)
            return true
        }

        mutating func consumeLink(image: Bool) -> Bool {
            let prefix = image ? "![" : "["
            guard source[index...].hasPrefix(prefix) else { return false }
            let labelStart = source.index(index, offsetBy: prefix.count)
            guard let labelEnd = source[labelStart...].firstIndex(of: "]"),
                  source.index(after: labelEnd) < source.endIndex,
                  source[source.index(after: labelEnd)] == "(",
                  let destinationEnd = source[source.index(labelEnd, offsetBy: 2)...].firstIndex(of: ")")
            else { return false }
            let destinationStart = source.index(labelEnd, offsetBy: 2)
            let destination = String(source[destinationStart..<destinationEnd])
            let label = String(source[labelStart..<labelEnd])
            let start = output.utf8.count
            var child = Parser(label)
            child.parse()
            output += child.output.isEmpty && image ? "Image" : child.output
            spans += child.spans.map { InlineSpan(byteStart: start + $0.byteStart, byteEnd: start + $0.byteEnd, feature: $0.feature) }
            let end = output.utf8.count
            if isSafeLink(destination), end > start {
                spans.append(InlineSpan(byteStart: start, byteEnd: end, feature: .link(destination)))
            } else if !destination.isEmpty {
                output += " (\(destination))"
            }
            index = source.index(after: destinationEnd)
            return true
        }

        private func isSafeLink(_ value: String) -> Bool {
            guard let scheme = URLComponents(string: value)?.scheme?.lowercased() else { return false }
            return ["https", "http", "mailto", "at"].contains(scheme)
        }
    }
}

private extension String {
    func components(separatedBy regex: NSRegularExpression) -> [String] {
        let range = NSRange(startIndex..<endIndex, in: self)
        let matches = regex.matches(in: self, range: range)
        var parts: [String] = []
        var cursor = startIndex
        for match in matches {
            guard let matchRange = Range(match.range, in: self) else { continue }
            parts.append(String(self[cursor..<matchRange.lowerBound]))
            cursor = matchRange.upperBound
        }
        parts.append(String(self[cursor...]))
        return parts
    }
}
