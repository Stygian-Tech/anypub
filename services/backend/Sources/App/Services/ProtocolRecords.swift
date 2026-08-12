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
    let publishedAt: ATProtoTimestamp
    let path: String?
    let tags: [String]?
    let langs: [String]?
    let coverImage: ATProtoBlobRef?
    let description: String?
    let textContent: String?
    let content: JSONValue?
    let updatedAt: ATProtoTimestamp?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case site
        case title
        case publishedAt
        case path
        case tags
        case langs
        case coverImage
        case description
        case textContent
        case content
        case updatedAt
    }
}

struct ATProtoTimestamp: Codable, Equatable, Sendable {
    let date: Date

    init(_ date: Date) {
        self.date = date
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        guard let date = fractional.date(from: value) ?? standard.date(from: value) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid AT Protocol timestamp"
            )
        }
        self.date = date
    }

    func encode(to encoder: Encoder) throws {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        var container = encoder.singleValueContainer()
        try container.encode(formatter.string(from: date))
    }
}

struct StrongReference: Codable, Equatable, Sendable {
    let uri: String
    let cid: String
}

struct OffprintArticleRecord: Codable, Equatable, Sendable {
    let type = "app.offprint.document.article"
    let document: StrongReference

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case document
    }
}

struct PcktDocumentRecord: Codable, Equatable, Sendable {
    let type = "blog.pckt.document"
    let document: StrongReference
    let site: String

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case document
        case site
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
    func documentRecord(
        draft: Draft,
        cover: ATProtoBlobRef?,
        content: JSONValue? = nil,
        textContent: String? = nil,
        pcktCompatible: Bool = false
    ) -> StandardSiteDocumentRecord {
        let tags = draft.tags()
        return StandardSiteDocumentRecord(
            site: draft.publicationURI,
            title: draft.title,
            publishedAt: ATProtoTimestamp(draft.publishedAt ?? draft.scheduledAt ?? Date()),
            path: draft.path,
            tags: tags.isEmpty && !pcktCompatible ? nil : tags,
            langs: pcktCompatible ? ["en"] : nil,
            coverImage: cover,
            description: draft.excerpt,
            textContent: textContent ?? draft.plaintext,
            content: content,
            updatedAt: ATProtoTimestamp(Date())
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
