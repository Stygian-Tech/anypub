import Fluent
import Vapor

enum DraftStatus: String, Codable, CaseIterable, Sendable {
    case draft
    case scheduled
    case publishing
    case published
    case failed
}

final class Draft: Model, Content, @unchecked Sendable {
    static let schema = "drafts"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "account_did")
    var accountDID: String

    @Field(key: "publication_uri")
    var publicationURI: String

    @Field(key: "publication_url")
    var publicationURL: String

    @Field(key: "title")
    var title: String

    @OptionalField(key: "path")
    var path: String?

    @OptionalField(key: "excerpt")
    var excerpt: String?

    @Field(key: "tags_json")
    var tagsJSON: String

    @Field(key: "markdown")
    var markdown: String

    @Field(key: "plaintext")
    var plaintext: String

    @OptionalField(key: "cover_asset_id")
    var coverAssetID: UUID?

    @Field(key: "status")
    var status: String

    @OptionalField(key: "scheduled_at")
    var scheduledAt: Date?

    @OptionalField(key: "published_at")
    var publishedAt: Date?

    @OptionalField(key: "document_uri")
    var documentURI: String?

    @OptionalField(key: "document_cid")
    var documentCID: String?

    @Field(key: "created_at")
    var createdAt: Date

    @Field(key: "updated_at")
    var updatedAt: Date

    init() {}

    init(
        id: UUID? = nil,
        accountDID: String,
        publicationURI: String,
        publicationURL: String,
        title: String,
        path: String?,
        excerpt: String?,
        tags: [String],
        markdown: String,
        coverAssetID: UUID? = nil,
        status: DraftStatus = .draft,
        scheduledAt: Date? = nil,
        publishedAt: Date? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) throws {
        self.id = id
        self.accountDID = accountDID
        self.publicationURI = publicationURI
        self.publicationURL = publicationURL
        self.title = title
        self.path = path
        self.excerpt = excerpt
        self.tagsJSON = try TagsCodec.encode(tags)
        self.markdown = markdown
        self.plaintext = MarkdownPlaintext.render(markdown)
        self.coverAssetID = coverAssetID
        self.status = status.rawValue
        self.scheduledAt = scheduledAt
        self.publishedAt = publishedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var typedStatus: DraftStatus {
        get { DraftStatus(rawValue: status) ?? .draft }
        set { status = newValue.rawValue }
    }

    func tags() -> [String] {
        (try? TagsCodec.decode(tagsJSON)) ?? []
    }
}
