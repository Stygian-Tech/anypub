import Fluent
import Vapor

final class OAuthStateRecord: Model, Content, @unchecked Sendable {
    static let schema = "oauth_states"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "state")
    var state: String

    @Field(key: "handle")
    var handle: String

    @Field(key: "code_verifier")
    var codeVerifier: String

    @Field(key: "redirect_url")
    var redirectURL: String

    @Field(key: "created_at")
    var createdAt: Date

    @Field(key: "expires_at")
    var expiresAt: Date

    init() {}

    init(
        id: UUID? = nil,
        state: String,
        handle: String,
        codeVerifier: String,
        redirectURL: String,
        createdAt: Date = Date(),
        expiresAt: Date
    ) {
        self.id = id
        self.state = state
        self.handle = handle
        self.codeVerifier = codeVerifier
        self.redirectURL = redirectURL
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }
}
