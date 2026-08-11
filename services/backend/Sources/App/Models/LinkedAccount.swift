import Fluent
import Vapor

final class LinkedAccount: Model, Content, @unchecked Sendable {
    static let schema = "linked_accounts"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "did")
    var did: String

    @Field(key: "handle")
    var handle: String

    @OptionalField(key: "display_name")
    var displayName: String?

    @OptionalField(key: "avatar_cid")
    var avatarCID: String?

    @Field(key: "pds_url")
    var pdsURL: String

    @Field(key: "scope")
    var scope: String

    @Field(key: "access_token")
    var accessToken: String

    @Field(key: "refresh_token")
    var refreshToken: String

    @OptionalField(key: "token_endpoint")
    var tokenEndpoint: String?

    @OptionalField(key: "dpop_key_json")
    var dpopKeyJSON: String?

    @Field(key: "linked_at")
    var linkedAt: Date

    @Field(key: "updated_at")
    var updatedAt: Date

    init() {}

    init(
        id: UUID? = nil,
        did: String,
        handle: String,
        displayName: String? = nil,
        avatarCID: String? = nil,
        pdsURL: String,
        scope: String,
        accessToken: String,
        refreshToken: String,
        tokenEndpoint: String? = nil,
        dpopKeyJSON: String? = nil,
        linkedAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.did = did
        self.handle = handle
        self.displayName = displayName
        self.avatarCID = avatarCID
        self.pdsURL = pdsURL
        self.scope = scope
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.tokenEndpoint = tokenEndpoint
        self.dpopKeyJSON = dpopKeyJSON
        self.linkedAt = linkedAt
        self.updatedAt = updatedAt
    }
}
