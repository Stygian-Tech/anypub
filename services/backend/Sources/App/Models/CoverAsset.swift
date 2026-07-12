import Fluent
import Vapor

enum CoverAssetSource: String, Codable, Sendable {
    case device
    case unsplash
}

final class CoverAsset: Model, Content, @unchecked Sendable {
    static let schema = "cover_assets"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "account_did")
    var accountDID: String

    @Field(key: "source")
    var source: String

    @Field(key: "file_path")
    var filePath: String

    @Field(key: "mime_type")
    var mimeType: String

    @Field(key: "byte_size")
    var byteSize: Int

    @OptionalField(key: "alt_text")
    var altText: String?

    @OptionalField(key: "attribution_json")
    var attributionJSON: String?

    @OptionalField(key: "blob_json")
    var blobJSON: String?

    @Field(key: "created_at")
    var createdAt: Date

    init() {}

    init(
        id: UUID? = nil,
        accountDID: String,
        source: CoverAssetSource,
        filePath: String,
        mimeType: String,
        byteSize: Int,
        altText: String?,
        attributionJSON: String?,
        blobJSON: String? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.accountDID = accountDID
        self.source = source.rawValue
        self.filePath = filePath
        self.mimeType = mimeType
        self.byteSize = byteSize
        self.altText = altText
        self.attributionJSON = attributionJSON
        self.blobJSON = blobJSON
        self.createdAt = createdAt
    }
}
