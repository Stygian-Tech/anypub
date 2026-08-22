import Foundation
import Vapor

/// A blob referenced by a published document that AnyPub did not write itself.
struct ImportedBlob: Equatable, Sendable {
    let cid: String
    let mimeType: String
    let alt: String
    let width: Int?
    let height: Int?
}

struct ImportedDocument: Equatable, Sendable {
    let publicationURI: String
    let title: String
    let path: String?
    let description: String?
    let tags: [String]
    let publishedAt: Date?
    let updatedAt: Date?
    let cover: ImportedBlob?
    let markdown: String
    let images: [ImportedBlob]
}

/// Reverses the publishing adapters: a `site.standard.document` record from the PDS becomes the
/// Markdown a draft holds. Body images keep an `anypub-import-blob://` placeholder until the caller
/// resolves them into local assets.
enum DocumentImporter {
    static let blobPlaceholderScheme = "anypub-import-blob://"

    /// Bodies larger than a host's inline limit live in a blob the caller must download first.
    static func contentBlobCID(value: JSONValue) -> String? {
        guard let content = value.objectValue?["content"]?.objectValue else { return nil }
        return content["blobPages"]?.blobCID
            ?? content["blob"]?.blobCID
            ?? content["text"]?.objectValue?["textBlob"]?.blobCID
    }

    static func imported(record: RepositoryRecord<JSONValue>, contentBlob: Data? = nil) -> ImportedDocument? {
        guard let value = record.value.objectValue else { return nil }
        if let declaredType = value["$type"]?.stringValue, declaredType != "site.standard.document" {
            return nil
        }
        guard let site = value["site"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !site.isEmpty
        else { return nil }

        var images: [ImportedBlob] = []
        let description = value["description"]?.stringValue?.nilIfBlank
        let markdown = withoutSummaryHeading(
            body(value: value, contentBlob: contentBlob, images: &images),
            description: description
        )
        let title = value["title"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        return ImportedDocument(
            publicationURI: site,
            title: title.isEmpty ? "Untitled post" : title,
            path: value["path"]?.stringValue?.nilIfBlank,
            description: description,
            tags: value["tags"]?.arrayValue?.compactMap { $0.stringValue?.nilIfBlank } ?? [],
            publishedAt: date(value["publishedAt"]),
            updatedAt: date(value["updatedAt"]),
            cover: blob(value["coverImage"], alt: value["title"]?.stringValue ?? ""),
            markdown: markdown,
            images: images
        )
    }

    // MARK: - Body

    private static func body(value: [String: JSONValue], contentBlob: Data?, images: inout [ImportedBlob]) -> String {
        let content = value["content"]?.objectValue
        let fallback = value["textContent"]?.stringValue ?? ""

        if let markdown = markpubMarkdown(content: content, contentBlob: contentBlob) {
            return normalize(markdown)
        }
        let blocks = blockValues(content: content, contentBlob: contentBlob)
        guard !blocks.isEmpty else { return paragraphs(from: fallback) }
        let rendered = blocks.flatMap { markdownBlocks(from: $0, images: &images) }
        let markdown = normalize(rendered.joined(separator: "\n\n"))
        return markdown.isEmpty ? paragraphs(from: fallback) : markdown
    }

    /// pckt bodies lead with the description as a heading, which publishing adds back, so the
    /// imported body keeps the excerpt in its own field instead of repeating it.
    private static func withoutSummaryHeading(_ markdown: String, description: String?) -> String {
        guard let description else { return markdown }
        var blocks = markdown.components(separatedBy: "\n\n")
        guard let first = blocks.first,
              let heading = first.range(of: #"^#{1,6}\s+"#, options: .regularExpression),
              String(first[heading.upperBound...]).trimmingCharacters(in: .whitespaces) == description
        else { return markdown }
        blocks.removeFirst()
        return blocks.joined(separator: "\n\n")
    }

    private static func markpubMarkdown(content: [String: JSONValue]?, contentBlob: Data?) -> String? {
        guard let text = content?["text"]?.objectValue else { return nil }
        if text["textBlob"]?.blobCID != nil, let contentBlob {
            return String(decoding: contentBlob, as: UTF8.self)
        }
        return text["markdown"]?.stringValue
    }

    private static func blockValues(content: [String: JSONValue]?, contentBlob: Data?) -> [JSONValue] {
        guard let content else { return [] }
        let offloaded = contentBlob.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }

        if content["pages"] != nil || content["blobPages"] != nil {
            let pages = offloaded.flatMap { $0.arrayValue ?? $0.objectValue?["pages"]?.arrayValue }
                ?? content["pages"]?.arrayValue
                ?? []
            return pages.flatMap { page -> [JSONValue] in
                (page.objectValue?["blocks"]?.arrayValue ?? []).map { entry in
                    entry.objectValue?["block"] ?? entry
                }
            }
        }

        return offloaded.flatMap { $0.arrayValue ?? $0.objectValue?["items"]?.arrayValue }
            ?? content["items"]?.arrayValue
            ?? []
    }

    private static func markdownBlocks(from value: JSONValue, images: inout [ImportedBlob]) -> [String] {
        guard let object = value.objectValue else { return [] }
        switch blockKind(object) {
        case "heading", "header":
            let text = inline(object)
            guard !text.isEmpty else { return [] }
            let level = max(1, min(6, object["level"]?.integerValue ?? 1))
            return ["\(String(repeating: "#", count: level)) \(text)"]
        case "blockquote", "quote":
            let lines = quoteLines(object)
            return lines.isEmpty ? [] : [lines.map { "> \($0)" }.joined(separator: "\n")]
        case "unorderedlist", "bulletlist":
            let lines = listLines(object, kind: .unordered, level: 0, images: &images)
            return lines.isEmpty ? [] : [lines.joined(separator: "\n")]
        case "orderedlist":
            let lines = listLines(object, kind: .ordered, level: 0, images: &images)
            return lines.isEmpty ? [] : [lines.joined(separator: "\n")]
        case "tasklist", "checklist":
            let lines = listLines(object, kind: .task, level: 0, images: &images)
            return lines.isEmpty ? [] : [lines.joined(separator: "\n")]
        case "code", "codeblock":
            let source = object["plaintext"]?.stringValue
                ?? object["code"]?.stringValue
                ?? object["text"]?.stringValue
                ?? ""
            guard !source.isEmpty else { return [] }
            let language = object["language"]?.stringValue?.nilIfBlank ?? ""
            return ["```\(language)\n\(source)\n```"]
        case "image":
            guard let image = blob(imageBlob(object), alt: imageAlt(object), aspectRatio: aspectRatio(object)) else {
                return []
            }
            images.append(image)
            return ["![\(escapedAlt(image.alt))](\(blobPlaceholderScheme)\(image.cid))"]
        case "horizontalrule", "rule", "divider", "separator":
            return ["---"]
        case "website", "webembed", "embed", "link", "bookmark":
            guard let url = embedURL(object) else { return [] }
            return ["@[embed](\(url))"]
        default:
            let text = inline(object)
            return text.isEmpty ? [] : [text]
        }
    }

    private static func blockKind(_ object: [String: JSONValue]) -> String {
        guard let type = object["$type"]?.stringValue else { return "" }
        return (type.split(separator: ".").last.map(String.init) ?? type).lowercased()
    }

    private static func quoteLines(_ object: [String: JSONValue]) -> [String] {
        let nested = object["content"]?.arrayValue ?? object["children"]?.arrayValue
        if let nested {
            return nested.flatMap { entry in
                inline(entry.objectValue ?? [:]).components(separatedBy: "\n")
            }.filter { !$0.isEmpty }
        }
        return inline(object).components(separatedBy: "\n").filter { !$0.isEmpty }
    }

    // MARK: - Lists

    private static func listLines(
        _ object: [String: JSONValue],
        kind: CanonicalListKind,
        level: Int,
        images: inout [ImportedBlob]
    ) -> [String] {
        let items = object["children"]?.arrayValue ?? object["content"]?.arrayValue ?? []
        let start = object["startIndex"]?.integerValue ?? object["start"]?.integerValue ?? 1
        return itemLines(items, kind: kind, start: max(1, start), level: level, images: &images)
    }

    private static func itemLines(
        _ items: [JSONValue],
        kind: CanonicalListKind,
        start: Int,
        level: Int,
        images: inout [ImportedBlob]
    ) -> [String] {
        let indent = String(repeating: "\t", count: min(4, level))
        var lines: [String] = []

        for (offset, entry) in items.enumerated() {
            guard let item = entry.objectValue else { continue }
            let checked = item["checked"]?.boolValue
            let itemKind = checked == nil ? kind : .task
            let content = item["content"]
            var text = ""
            var nestedBlocks: [JSONValue] = []

            if let contentObject = content?.objectValue {
                text = inline(contentObject)
            } else if let contentArray = content?.arrayValue {
                for value in contentArray {
                    guard let object = value.objectValue else { continue }
                    if isListBlock(object) {
                        nestedBlocks.append(value)
                    } else if text.isEmpty {
                        text = inline(object)
                    }
                }
            } else {
                text = inline(item)
            }

            let marker = switch itemKind {
            case .ordered: "\(start + offset). "
            case .task: checked == true ? "- [x] " : "- [ ] "
            case .unordered: "- "
            }
            lines.append(indent + marker + text.replacingOccurrences(of: "\n", with: " "))

            if let children = item["children"]?.arrayValue, !children.isEmpty {
                lines += itemLines(children, kind: itemKind, start: 1, level: level + 1, images: &images)
            }
            for key in ["unorderedListChildren", "orderedListChildren"] {
                guard let child = item[key]?.objectValue else { continue }
                lines += listLines(
                    child,
                    kind: key == "orderedListChildren" ? .ordered : .unordered,
                    level: level + 1,
                    images: &images
                )
            }
            for nested in nestedBlocks {
                guard let object = nested.objectValue else { continue }
                lines += listLines(object, kind: listKind(object), level: level + 1, images: &images)
            }
        }
        return lines
    }

    private static func isListBlock(_ object: [String: JSONValue]) -> Bool {
        ["unorderedlist", "bulletlist", "orderedlist", "tasklist", "checklist"].contains(blockKind(object))
    }

    private static func listKind(_ object: [String: JSONValue]) -> CanonicalListKind {
        switch blockKind(object) {
        case "orderedlist": .ordered
        case "tasklist", "checklist": .task
        default: .unordered
        }
    }

    // MARK: - Rich text

    private static func inline(_ object: [String: JSONValue]) -> String {
        let plaintext = object["plaintext"]?.stringValue ?? object["text"]?.stringValue ?? ""
        guard !plaintext.isEmpty else { return "" }
        return inlineMarkdown(plaintext, facets: facets(object["facets"]))
    }

    private struct ImportedFacet {
        let start: Int
        let end: Int
        let feature: InlineFeature
    }

    private static func facets(_ value: JSONValue?) -> [ImportedFacet] {
        (value?.arrayValue ?? []).compactMap { entry -> ImportedFacet? in
            guard let facet = entry.objectValue,
                  let index = facet["index"]?.objectValue,
                  let start = index["byteStart"]?.integerValue,
                  let end = index["byteEnd"]?.integerValue,
                  end > start,
                  let feature = facet["features"]?.arrayValue?.compactMap(self.feature).first
            else { return nil }
            return ImportedFacet(start: start, end: end, feature: feature)
        }
    }

    private static func feature(_ value: JSONValue) -> InlineFeature? {
        guard let object = value.objectValue,
              let type = object["$type"]?.stringValue,
              let name = type.split(separator: "#").last.map(String.init)?.lowercased()
        else { return nil }
        switch name {
        case "bold", "strong": return .bold
        case "italic", "em": return .italic
        case "code": return .code
        case "strikethrough", "strike": return .strikethrough
        case "underline": return .underline
        case "link":
            guard let uri = object["uri"]?.stringValue ?? object["href"]?.stringValue, !uri.isEmpty else { return nil }
            return .link(uri)
        default: return nil
        }
    }

    private static func inlineMarkdown(_ text: String, facets: [ImportedFacet]) -> String {
        let bytes = Array(text.utf8)
        let usable = facets
            .filter { $0.start >= 0 && $0.end <= bytes.count }
            .sorted { $0.start == $1.start ? $0.end > $1.end : $0.start < $1.start }
        return render(bytes, from: 0, to: bytes.count, facets: usable)
    }

    private static func render(_ bytes: [UInt8], from lower: Int, to upper: Int, facets: [ImportedFacet]) -> String {
        var output = ""
        var cursor = lower
        var index = 0

        while index < facets.count {
            let facet = facets[index]
            guard facet.start >= cursor, facet.end <= upper else {
                index += 1
                continue
            }
            output += slice(bytes, cursor, facet.start)
            var nested: [ImportedFacet] = []
            var next = index + 1
            while next < facets.count, facets[next].start < facet.end {
                if facets[next].end <= facet.end { nested.append(facets[next]) }
                next += 1
            }
            let inner = if case .code = facet.feature {
                slice(bytes, facet.start, facet.end)
            } else {
                render(bytes, from: facet.start, to: facet.end, facets: nested)
            }
            output += wrap(inner, in: facet.feature)
            cursor = facet.end
            index = next
        }
        return output + slice(bytes, cursor, upper)
    }

    private static func wrap(_ text: String, in feature: InlineFeature) -> String {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return text }
        switch feature {
        case .bold: return "**\(text)**"
        case .italic: return "*\(text)*"
        case .code: return text.contains("`") ? text : "`\(text)`"
        case .strikethrough: return "~~\(text)~~"
        case .underline: return "++\(text)++"
        case .link(let uri):
            guard !uri.contains(")"), !uri.contains(" "), !text.contains("]") else { return text }
            return "[\(text)](\(uri))"
        }
    }

    private static func slice(_ bytes: [UInt8], _ lower: Int, _ upper: Int) -> String {
        guard upper > lower, lower >= 0, upper <= bytes.count else { return "" }
        return String(decoding: bytes[lower..<upper], as: UTF8.self)
    }

    // MARK: - Blobs and metadata

    private static func imageBlob(_ object: [String: JSONValue]) -> JSONValue? {
        let attributes = object["attrs"]?.objectValue ?? [:]
        return object["image"] ?? object["blob"] ?? attributes["blob"] ?? attributes["image"]
    }

    private static func imageAlt(_ object: [String: JSONValue]) -> String {
        object["alt"]?.stringValue
            ?? object["attrs"]?.objectValue?["alt"]?.stringValue
            ?? ""
    }

    private static func aspectRatio(_ object: [String: JSONValue]) -> [String: JSONValue]? {
        object["aspectRatio"]?.objectValue ?? object["attrs"]?.objectValue?["aspectRatio"]?.objectValue
    }

    private static func blob(_ value: JSONValue?, alt: String, aspectRatio: [String: JSONValue]? = nil) -> ImportedBlob? {
        guard let value, let cid = value.blobCID, !cid.isEmpty else { return nil }
        return ImportedBlob(
            cid: cid,
            mimeType: value.objectValue?["mimeType"]?.stringValue?.nilIfBlank ?? "application/octet-stream",
            alt: alt,
            width: aspectRatio?["width"]?.integerValue,
            height: aspectRatio?["height"]?.integerValue
        )
    }

    private static func embedURL(_ object: [String: JSONValue]) -> String? {
        let candidate = object["src"]?.stringValue
            ?? object["href"]?.stringValue
            ?? object["uri"]?.stringValue
            ?? object["url"]?.stringValue
        guard let candidate,
              let components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host != nil,
              !candidate.contains(")")
        else { return nil }
        return candidate
    }

    private static func escapedAlt(_ alt: String) -> String {
        alt.replacingOccurrences(of: "]", with: "")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }

    private static func date(_ value: JSONValue?) -> Date? {
        guard let text = value?.stringValue else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return fractional.date(from: text) ?? standard.date(from: text)
    }

    private static func paragraphs(from text: String) -> String {
        normalize(text.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n"))
    }

    private static func normalize(_ markdown: String) -> String {
        markdown
            .replacingOccurrences(of: #"\r\n?"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
