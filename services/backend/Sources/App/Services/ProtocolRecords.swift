import Foundation
import Vapor

struct ATProtoBlobRef: Codable, Equatable, Sendable {
    struct Link: Codable, Equatable, Sendable {
        let link: String

        enum CodingKeys: String, CodingKey {
            case link = "$link"
        }
    }

    let type: String
    let ref: Link
    let mimeType: String
    let size: Int

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case ref
        case mimeType
        case size
    }
}

struct StandardSiteDocumentRecord: Codable, Equatable, Sendable {
    let type = "site.standard.document"
    let site: String
    let title: String
    let publishedAt: Date
    let path: String?
    let tags: [String]?
    let coverImage: ATProtoBlobRef?
    let description: String?
    let textContent: String?
    let content: [TargetContentBlock]?
    let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case site
        case title
        case publishedAt
        case path
        case tags
        case coverImage
        case description
        case textContent
        case content
        case updatedAt
    }
}

struct TargetContentBlock: Codable, Equatable, Sendable {
    let type: String
    let style: String
    let text: String
    let level: Int?
    let sequence: Int?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case style
        case text
        case level
        case sequence
    }
}

struct CalendarEventRecord: Codable, Equatable, Sendable {
    struct EventURI: Codable, Equatable, Sendable {
        let uri: String
        let name: String?
    }

    let type = "community.lexicon.calendar.event"
    let name: String
    let startsAt: Date
    let endsAt: Date?
    let createdAt: Date
    let status: String
    let mode: String
    let description: String?
    let uris: [EventURI]

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case name
        case startsAt
        case endsAt
        case createdAt
        case status
        case mode
        case description
        case uris
    }
}

struct ProtocolRecordBuilder: Sendable {
    func documentRecord(draft: Draft, cover: ATProtoBlobRef?, host: PublicationHost? = nil) -> StandardSiteDocumentRecord {
        StandardSiteDocumentRecord(
            site: draft.publicationURI,
            title: draft.title,
            publishedAt: draft.publishedAt ?? draft.scheduledAt ?? Date(),
            path: draft.path,
            tags: draft.tags().isEmpty ? nil : draft.tags(),
            coverImage: cover,
            description: draft.excerpt,
            textContent: draft.plaintext,
            content: host.map { TargetContentAdapter(host: $0).blocks(from: draft.markdown) },
            updatedAt: Date()
        )
    }

    func calendarEventRecord(draft: Draft, articleURI: String?) -> CalendarEventRecord {
        let startsAt = draft.scheduledAt ?? draft.publishedAt ?? Date()
        let canonicalURL = CanonicalURLBuilder.documentURL(publicationURL: draft.publicationURL, path: draft.path)
        let uris = [
            CalendarEventRecord.EventURI(uri: canonicalURL, name: "Article URL"),
            articleURI.map { CalendarEventRecord.EventURI(uri: $0, name: "ATProto record") },
        ].compactMap { $0 }

        return CalendarEventRecord(
            name: draft.title,
            startsAt: startsAt,
            endsAt: nil,
            createdAt: Date(),
            status: "community.lexicon.calendar.event#scheduled",
            mode: "community.lexicon.calendar.event#virtual",
            description: draft.excerpt ?? draft.plaintext.prefixString(maxLength: 280),
            uris: uris
        )
    }
}

struct TargetContentAdapter: Sendable {
    let host: PublicationHost

    func blocks(from markdown: String) -> [TargetContentBlock] {
        MarkdownContentTranslator.blocks(from: markdown).map { block in
            TargetContentBlock(
                type: blockType,
                style: style(for: block),
                text: block.text,
                level: block.level,
                sequence: block.sequence
            )
        }
    }

    private var blockType: String {
        switch host {
        case .leaflet:
            return "pub.leaflet.blocks.text"
        case .offprint:
            return "pub.offprint.blocks.text"
        case .pckt:
            return "app.pckt.blocks.text"
        }
    }

    private func style(for block: MarkdownContentBlock) -> String {
        switch (host, block.style) {
        case (_, .paragraph):
            return "paragraph"
        case (_, .heading):
            return "heading\(block.level ?? 1)"
        case (_, .quote):
            return "quote"
        case (_, .unorderedListItem):
            return "unorderedListItem"
        case (_, .orderedListItem):
            return "orderedListItem"
        case (_, .code):
            return "code"
        }
    }
}

enum CanonicalURLBuilder {
    static func documentURL(publicationURL: String, path: String?) -> String {
        let base = publicationURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let path, !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return base
        }
        let cleaned = path.hasPrefix("/") ? path : "/\(path)"
        return "\(base)\(cleaned)"
    }
}

extension String {
    func prefixString(maxLength: Int) -> String {
        if count <= maxLength { return self }
        return String(prefix(maxLength))
    }
}

extension Substring {
    func prefixString(maxLength: Int) -> String {
        String(self).prefixString(maxLength: maxLength)
    }
}
