import Foundation
import Vapor

enum PublicationContentOffload: Equatable, Sendable {
    case leafletPages(Data)
    case markpubMarkdown(Data)
    case pcktItems(Data)

    var mimeType: String {
        switch self {
        case .leafletPages, .pcktItems: "application/json"
        case .markpubMarkdown: "text/markdown"
        }
    }
}

struct PreparedPublicationContent: Equatable, Sendable {
    let host: PublicationHost
    let content: JSONValue
    let textContent: String
    let offload: PublicationContentOffload?

    func replacingOffload(with blob: ATProtoBlobRef) -> JSONValue {
        guard let offload else { return content }
        switch offload {
        case .leafletPages:
            return .object([
                "$type": .string("pub.leaflet.content"),
                "pages": .array([]),
                "blobPages": blob.jsonValue,
                "blobs": .array([]),
            ])
        case .markpubMarkdown(let data):
            let markdown = String(decoding: data, as: UTF8.self)
            return .object([
                "$type": .string("at.markpub.markdown"),
                "flavor": .string("gfm"),
                "text": .object([
                    "$type": .string("at.markpub.text"),
                    "markdown": .string(String(markdown.prefix(1_000))),
                    "textBlob": blob.jsonValue,
                ]),
            ])
        case .pcktItems:
            return .object([
                "$type": .string("blog.pckt.content"),
                "blob": blob.jsonValue,
                "references": .array([]),
            ])
        }
    }
}

struct PublishedBodyImage: Equatable, Sendable {
    let assetID: UUID
    let blob: ATProtoBlobRef
    let alt: String
    let width: Int
    let height: Int
    let publicURL: String
}

enum PublicationContentAdapter {
    static func prepare(
        document: CanonicalDocument,
        host: PublicationHost,
        description: String? = nil,
        images: [PublishedBodyImage] = []
    ) throws -> PreparedPublicationContent {
        let imageMap = Dictionary(uniqueKeysWithValues: images.map { ($0.assetID, $0) })
        let requiredImageIDs = Set(document.blocks.compactMap { block -> UUID? in
            if case .image(let assetID, _) = block { return assetID }
            return nil
        })
        guard requiredImageIDs.isSubset(of: Set(imageMap.keys)) else {
            throw Abort(.unprocessableEntity, reason: "One or more body images are unavailable")
        }
        switch host {
        case .leaflet: return try LeafletContentAdapter.prepare(document, images: imageMap)
        case .markpub: return try MarkpubContentAdapter.prepare(document, images: imageMap)
        case .offprint: return try OffprintContentAdapter.prepare(document, images: imageMap)
        case .pckt: return try PcktContentAdapter.prepare(document, description: description, images: imageMap)
        }
    }
}

private enum MarkpubContentAdapter {
    static func prepare(_ document: CanonicalDocument, images: [UUID: PublishedBodyImage]) throws -> PreparedPublicationContent {
        var markdown = document.markdown
        for image in images.values {
            markdown = markdown.replacingOccurrences(of: "anypub-asset://\(image.assetID.uuidString)", with: image.publicURL)
        }
        markdown = markdown.replacingOccurrences(
            of: #"@\[embed\]\((https?://[^\s)]+)\)"#,
            with: "[$1]($1)",
            options: .regularExpression
        )
        let data = Data(markdown.utf8)
        guard data.count <= 1_000_000 else {
            throw Abort(.unprocessableEntity, reason: "Article exceeds Markpub's Markdown blob-size limit")
        }
        let content: JSONValue = .object([
            "$type": .string("at.markpub.markdown"),
            "flavor": .string("gfm"),
            "text": .object([
                "$type": .string("at.markpub.text"),
                "markdown": .string(markdown),
            ]),
        ])
        return PreparedPublicationContent(
            host: .markpub,
            content: content,
            textContent: document.plaintext,
            offload: data.count > 100 * 1_024 ? .markpubMarkdown(data) : nil
        )
    }
}

private enum LeafletContentAdapter {
    static func prepare(_ document: CanonicalDocument, images: [UUID: PublishedBodyImage]) throws -> PreparedPublicationContent {
        let blocks = document.blocks.map { block($0, images: images) }
        let pages: JSONValue = .array([
            .object([
                "$type": .string("pub.leaflet.pages.linearDocument"),
                "blocks": .array(blocks.map {
                    .object([
                        "$type": .string("pub.leaflet.pages.linearDocument#block"),
                        "block": $0,
                    ])
                }),
            ]),
        ])
        let content: JSONValue = .object([
            "$type": .string("pub.leaflet.content"),
            "pages": pages,
        ])
        let data = try JSONEncoder().encode(pages)
        return PreparedPublicationContent(
            host: .leaflet,
            content: content,
            textContent: document.plaintext,
            offload: data.count > 100 * 1_024 ? .leafletPages(data) : nil
        )
    }

    private static func block(_ block: CanonicalBlock, images: [UUID: PublishedBodyImage]) -> JSONValue {
        switch block {
        case .paragraph(let text):
            return richText(text, type: "pub.leaflet.blocks.text", facetNSID: "pub.leaflet.richtext.facet")
        case .heading(let level, let text):
            return richText(text, type: "pub.leaflet.blocks.header", facetNSID: "pub.leaflet.richtext.facet", extra: ["level": .integer(level)])
        case .quote(let lines):
            return richText(join(lines), type: "pub.leaflet.blocks.blockquote", facetNSID: "pub.leaflet.richtext.facet")
        case .list(let list):
            return listBlock(list)
        case .code(let language, let source):
            var object: [String: JSONValue] = ["$type": .string("pub.leaflet.blocks.code"), "plaintext": .string(source)]
            if let language = normalizedCodeLanguage(language) { object["language"] = .string(language) }
            return .object(object)
        case .image(let assetID, let alt):
            guard let image = images[assetID] else { return richText(RichText(plaintext: alt, spans: []), type: "pub.leaflet.blocks.text", facetNSID: "pub.leaflet.richtext.facet") }
            return .object([
                "$type": .string("pub.leaflet.blocks.image"),
                "image": image.blob.jsonValue,
                "alt": .string(alt),
                "aspectRatio": aspectRatio(image),
            ])
        case .embed(let url):
            return .object([
                "$type": .string("pub.leaflet.blocks.website"),
                "src": .string(url),
                "title": .string(url),
            ])
        case .thematicBreak:
            return .object(["$type": .string("pub.leaflet.blocks.horizontalRule")])
        }
    }

    private static func listBlock(_ list: CanonicalList) -> JSONValue {
        let ordered = list.kind == .ordered
        let type = ordered ? "pub.leaflet.blocks.orderedList" : "pub.leaflet.blocks.unorderedList"
        var object: [String: JSONValue] = [
            "$type": .string(type),
            "children": .array(list.items.map { item($0, parentOrdered: ordered) }),
        ]
        if ordered, let start = list.start { object["startIndex"] = .integer(start) }
        return .object(object)
    }

    private static func item(_ item: CanonicalListItem, parentOrdered: Bool) -> JSONValue {
        var object: [String: JSONValue] = [
            "content": richText(item.content, type: "pub.leaflet.blocks.text", facetNSID: "pub.leaflet.richtext.facet"),
        ]
        if let checked = item.checked { object["checked"] = .bool(checked) }
        for child in item.children {
            let childOrdered = child.kind == .ordered
            if childOrdered == parentOrdered {
                let existing = object["children"]?.arrayValue ?? []
                object["children"] = .array(existing + child.items.map { self.item($0, parentOrdered: childOrdered) })
            } else {
                let key = childOrdered ? "orderedListChildren" : "unorderedListChildren"
                if var existing = object[key]?.objectValue,
                   let existingChildren = existing["children"]?.arrayValue,
                   let additionalChildren = listBlock(child).objectValue?["children"]?.arrayValue {
                    existing["children"] = .array(existingChildren + additionalChildren)
                    object[key] = .object(existing)
                } else {
                    object[key] = listBlock(child)
                }
            }
        }
        return .object(object)
    }
}

private enum OffprintContentAdapter {
    static func prepare(_ document: CanonicalDocument, images: [UUID: PublishedBodyImage]) throws -> PreparedPublicationContent {
        let items = document.blocks.map { block($0, images: images) }
        let content: JSONValue = .object([
            "$type": .string("app.offprint.content"),
            "items": .array(items),
        ])
        guard try JSONEncoder().encode(content).count < 900_000 else {
            throw Abort(.unprocessableEntity, reason: "Article exceeds Offprint's record-size limit")
        }
        return PreparedPublicationContent(
            host: .offprint,
            content: content,
            textContent: document.plaintext,
            offload: nil
        )
    }

    private static func block(_ block: CanonicalBlock, images: [UUID: PublishedBodyImage]) -> JSONValue {
        switch block {
        case .paragraph(let text):
            return richText(text, type: "app.offprint.block.text", facetNSID: "app.offprint.richtext.facet")
        case .heading(let level, let text):
            return richText(text, type: "app.offprint.block.heading", facetNSID: "app.offprint.richtext.facet", extra: ["level": .integer(min(3, level))])
        case .quote(let lines):
            return .object([
                "$type": .string("app.offprint.block.blockquote"),
                "content": .array(lines.map { richText($0, type: "app.offprint.block.text", facetNSID: "app.offprint.richtext.facet") }),
            ])
        case .list(let list):
            return listBlock(list)
        case .code(let language, let source):
            var object: [String: JSONValue] = ["$type": .string("app.offprint.block.codeBlock"), "code": .string(source)]
            if let language = normalizedCodeLanguage(language) { object["language"] = .string(language) }
            return .object(object)
        case .image(let assetID, let alt):
            guard let image = images[assetID] else { return richText(RichText(plaintext: alt, spans: []), type: "app.offprint.block.text", facetNSID: "app.offprint.richtext.facet") }
            return .object([
                "$type": .string("app.offprint.block.image"),
                "image": image.blob.jsonValue,
                "alt": .string(alt),
                "width": .string("100%"),
                "alignment": .string("center"),
                "aspectRatio": aspectRatio(image),
            ])
        case .embed(let url):
            return .object([
                "$type": .string("app.offprint.block.webEmbed"),
                "href": .string(url),
                "title": .string(url),
                "width": .string("100%"),
                "alignment": .string("center"),
            ])
        case .thematicBreak:
            return .object(["$type": .string("app.offprint.block.horizontalRule")])
        }
    }

    private static func listBlock(_ list: CanonicalList) -> JSONValue {
        switch list.kind {
        case .task:
            return .object([
                "$type": .string("app.offprint.block.taskList"),
                "children": .array(list.items.map(taskItem)),
            ])
        case .ordered, .unordered:
            var object: [String: JSONValue] = [
                "$type": .string(list.kind == .ordered ? "app.offprint.block.orderedList" : "app.offprint.block.bulletList"),
                "children": .array(list.items.map(listItem)),
            ]
            if list.kind == .ordered, let start = list.start { object["start"] = .integer(start) }
            return .object(object)
        }
    }

    private static func listItem(_ item: CanonicalListItem) -> JSONValue {
        var object: [String: JSONValue] = [
            "content": richText(item.content, type: "app.offprint.block.text", facetNSID: "app.offprint.richtext.facet"),
        ]
        let children = item.children.flatMap(\.items).map(listItem)
        if !children.isEmpty { object["children"] = .array(children) }
        return .object(object)
    }

    private static func taskItem(_ item: CanonicalListItem) -> JSONValue {
        var object: [String: JSONValue] = [
            "checked": .bool(item.checked ?? false),
            "content": richText(item.content, type: "app.offprint.block.text", facetNSID: "app.offprint.richtext.facet"),
        ]
        let children = item.children.flatMap(\.items).map(taskItem)
        if !children.isEmpty { object["children"] = .array(children) }
        return .object(object)
    }
}

private enum PcktContentAdapter {
    static func prepare(_ document: CanonicalDocument, description: String?, images: [UUID: PublishedBodyImage]) throws -> PreparedPublicationContent {
        var blocks = document.blocks
        let summary = description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let insertsSummary = !summary.isEmpty && firstPlaintext(in: blocks) != summary
        if insertsSummary {
            blocks.insert(.heading(level: 3, content: RichText(plaintext: summary, spans: [])), at: 0)
        }
        if !endsInTextBlock(blocks) {
            blocks.append(.paragraph(RichText(plaintext: "", spans: [])))
        }
        let items: JSONValue = .array(blocks.map { block($0, images: images) })
        let content: JSONValue = .object([
            "$type": .string("blog.pckt.content"),
            "items": items,
        ])
        let data = try JSONEncoder().encode(items)
        let textContent = ([insertsSummary ? summary : "", document.plaintext])
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        return PreparedPublicationContent(
            host: .pckt,
            content: content,
            textContent: textContent,
            offload: data.count > 20_000 ? .pcktItems(data) : nil
        )
    }

    private static func firstPlaintext(in blocks: [CanonicalBlock]) -> String? {
        guard let first = blocks.first else { return nil }
        switch first {
        case .paragraph(let text), .heading(_, let text): return text.plaintext
        case .quote(let lines): return lines.first?.plaintext
        case .list(let list): return list.items.first?.content.plaintext
        case .code(_, let source): return source
        case .image(_, let alt): return alt
        case .embed(let url): return url
        case .thematicBreak: return nil
        }
    }

    private static func endsInTextBlock(_ blocks: [CanonicalBlock]) -> Bool {
        guard let last = blocks.last else { return false }
        if case .paragraph = last { return true }
        return false
    }

    private static func block(_ block: CanonicalBlock, images: [UUID: PublishedBodyImage]) -> JSONValue {
        switch block {
        case .paragraph(let text):
            return richText(text, type: "blog.pckt.block.text", facetNSID: "blog.pckt.richtext.facet")
        case .heading(let level, let text):
            return richText(text, type: "blog.pckt.block.heading", facetNSID: "blog.pckt.richtext.facet", extra: ["level": .integer(level)])
        case .quote(let lines):
            return .object([
                "$type": .string("blog.pckt.block.blockquote"),
                "content": .array(lines.map { richText($0, type: "blog.pckt.block.text", facetNSID: "blog.pckt.richtext.facet") }),
            ])
        case .list(let list):
            return listBlock(list)
        case .code(let language, let source):
            var object: [String: JSONValue] = ["$type": .string("blog.pckt.block.codeBlock"), "plaintext": .string(source)]
            if let language = normalizedCodeLanguage(language) {
                object["language"] = .string(String(decoding: language.utf8.prefix(50), as: UTF8.self))
            }
            return .object(object)
        case .image(let assetID, let alt):
            guard let image = images[assetID] else { return richText(RichText(plaintext: alt, spans: []), type: "blog.pckt.block.text", facetNSID: "blog.pckt.richtext.facet") }
            return .object([
                "$type": .string("blog.pckt.block.image"),
                "attrs": .object([
                    "src": .string("blob:\(image.blob.ref.link)"),
                    "blob": image.blob.jsonValue,
                    "alt": .string(alt),
                    "align": .string("center"),
                    "aspectRatio": aspectRatio(image),
                ]),
            ])
        case .embed(let url):
            return .object([
                "$type": .string("blog.pckt.block.website"),
                "src": .string(url),
                "title": .string(url),
            ])
        case .thematicBreak:
            return .object(["$type": .string("blog.pckt.block.horizontalRule")])
        }
    }

    private static func listBlock(_ list: CanonicalList) -> JSONValue {
        switch list.kind {
        case .task:
            return .object([
                "$type": .string("blog.pckt.block.taskList"),
                "content": .array(list.items.map(taskItem)),
            ])
        case .ordered, .unordered:
            var object: [String: JSONValue] = [
                "$type": .string(list.kind == .ordered ? "blog.pckt.block.orderedList" : "blog.pckt.block.bulletList"),
                "content": .array(list.items.map(listItem)),
            ]
            if list.kind == .ordered, let start = list.start { object["start"] = .integer(start) }
            return .object(object)
        }
    }

    private static func listItem(_ item: CanonicalListItem) -> JSONValue {
        var content = [richText(item.content, type: "blog.pckt.block.text", facetNSID: "blog.pckt.richtext.facet")]
        content.append(contentsOf: item.children.map(listBlock))
        return .object([
            "$type": .string("blog.pckt.block.listItem"),
            "content": .array(content),
        ])
    }

    private static func taskItem(_ item: CanonicalListItem) -> JSONValue {
        .object([
            "$type": .string("blog.pckt.block.taskItem"),
            "checked": .bool(item.checked ?? false),
            "content": .array([richText(item.content, type: "blog.pckt.block.text", facetNSID: "blog.pckt.richtext.facet")]),
        ])
    }
}

private func aspectRatio(_ image: PublishedBodyImage) -> JSONValue {
    .object([
        "width": .integer(max(1, image.width)),
        "height": .integer(max(1, image.height)),
    ])
}

private func normalizedCodeLanguage(_ language: String?) -> String? {
    let normalized = language?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    return normalized.isEmpty ? nil : normalized
}

private func richText(
    _ text: RichText,
    type: String,
    facetNSID: String,
    extra: [String: JSONValue] = [:]
) -> JSONValue {
    var object = extra
    object["$type"] = .string(type)
    object["plaintext"] = .string(text.plaintext)
    let facets = text.spans.compactMap { facet($0, nsid: facetNSID) }
    if !facets.isEmpty { object["facets"] = .array(facets) }
    return .object(object)
}

private func facet(_ span: InlineSpan, nsid: String) -> JSONValue? {
    guard span.byteEnd > span.byteStart else { return nil }
    var feature: [String: JSONValue]
    switch span.feature {
    case .bold: feature = ["$type": .string("\(nsid)#bold")]
    case .italic: feature = ["$type": .string("\(nsid)#italic")]
    case .code: feature = ["$type": .string("\(nsid)#code")]
    case .strikethrough: feature = ["$type": .string("\(nsid)#strikethrough")]
    case .underline: feature = ["$type": .string("\(nsid)#underline")]
    case .link(let uri): feature = ["$type": .string("\(nsid)#link"), "uri": .string(uri)]
    }
    return .object([
        "index": .object(["byteStart": .integer(span.byteStart), "byteEnd": .integer(span.byteEnd)]),
        "features": .array([.object(feature)]),
    ])
}

private func join(_ lines: [RichText]) -> RichText {
    var plaintext = ""
    var spans: [InlineSpan] = []
    for (index, line) in lines.enumerated() {
        if index > 0 { plaintext += "\n" }
        let offset = plaintext.utf8.count
        plaintext += line.plaintext
        spans += line.spans.map { InlineSpan(byteStart: offset + $0.byteStart, byteEnd: offset + $0.byteEnd, feature: $0.feature) }
    }
    return RichText(plaintext: plaintext, spans: spans)
}

private extension ATProtoBlobRef {
    var jsonValue: JSONValue {
        .object([
            "$type": .string(type),
            "ref": .object(["$link": .string(ref.link)]),
            "mimeType": .string(mimeType),
            "size": .integer(size),
        ])
    }
}
