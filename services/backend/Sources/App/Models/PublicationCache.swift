import Fluent
import Vapor

final class PublicationCache: Model, Content, @unchecked Sendable {
    static let schema = "publication_cache"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "account_did")
    var accountDID: String

    @Field(key: "uri")
    var uri: String

    @OptionalField(key: "cid")
    var cid: String?

    @Field(key: "name")
    var name: String

    @Field(key: "url")
    var url: String

    @OptionalField(key: "description")
    var publicationDescription: String?

    @OptionalField(key: "theme_type")
    var themeType: String?

    @OptionalField(key: "theme_name")
    var themeName: String?

    @OptionalField(key: "host")
    var host: String?

    @Field(key: "synced_at")
    var syncedAt: Date

    init() {}

    init(
        id: UUID? = nil,
        accountDID: String,
        uri: String,
        cid: String?,
        name: String,
        url: String,
        publicationDescription: String?,
        themeType: String? = nil,
        themeName: String? = nil,
        host: PublicationHost? = nil,
        syncedAt: Date = Date()
    ) {
        self.id = id
        self.accountDID = accountDID
        self.uri = uri
        self.cid = cid
        self.name = name
        self.url = url
        self.publicationDescription = publicationDescription
        self.themeType = themeType
        self.themeName = themeName
        self.host = host?.rawValue
        self.syncedAt = syncedAt
    }

    var publicationHost: PublicationHost? {
        guard let host else { return nil }
        return PublicationHost(rawValue: host)
    }
}
