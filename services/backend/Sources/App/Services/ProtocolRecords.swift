import Foundation
import AnyPubKit
import Vapor

typealias ATProtoBlobRef = AnyPubKit.ATProtoBlobRef
typealias StandardSiteDocumentRecord = AnyPubKit.StandardSiteDocumentRecord
typealias ATProtoTimestamp = AnyPubKit.ATProtoTimestamp
typealias StrongReference = AnyPubKit.StrongReference

typealias OffprintArticleRecord = AnyPubKit.OffprintArticleRecord
typealias PcktDocumentRecord = AnyPubKit.PcktDocumentRecord

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

struct UserInputDiscussionRecord: Codable, Equatable, Sendable {
    struct Image: Codable, Equatable, Sendable {
        let image: ATProtoBlobRef
        let alt: String
    }

    let type = "app.userinput.discussion"
    let space: StrongReference
    let title: String
    let body: String?
    let tags: [String]?
    let images: [Image]?
    let createdAt: ATProtoTimestamp

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case space
        case title
        case body
        case tags
        case images
        case createdAt
    }
}

struct UserInputUpvoteRecord: Codable, Equatable, Sendable {
    let type = "app.userinput.upvote"
    let subject: StrongReference
    let createdAt: ATProtoTimestamp

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case subject
        case createdAt
    }
}

struct ProtocolRecordBuilder: Sendable {
    func documentRecord(
        draft: Draft,
        cover: ATProtoBlobRef?,
        content: JSONValue? = nil,
        textContent: String? = nil,
        pcktCompatible: Bool = false
    ) throws -> StandardSiteDocumentRecord {
        let tags = draft.tags()
        let now = Date()
        do {
            return try AnyPubKit.StandardSiteRecordBuilder().documentRecord(
                site: draft.publicationURI,
                title: draft.title,
                publishedAt: draft.publishedAt ?? draft.scheduledAt ?? now,
                path: draft.path,
                tags: tags.isEmpty && !pcktCompatible ? nil : tags,
                langs: pcktCompatible ? ["en"] : nil,
                coverImage: cover,
                description: draft.excerpt,
                textContent: textContent ?? draft.plaintext,
                content: content,
                updatedAt: now
            )
        } catch let AnyPubKit.StandardSiteValidationError.invalidField(field, reason) {
            throw Abort(.unprocessableEntity, reason: "Invalid \(field): \(reason)")
        }
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
