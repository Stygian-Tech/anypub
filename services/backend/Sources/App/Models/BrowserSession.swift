import Fluent
import Vapor

final class BrowserSession: Model, @unchecked Sendable {
    static let schema = "browser_sessions"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "token_hash")
    var tokenHash: String

    @OptionalField(key: "account_did")
    var accountDID: String?

    @Field(key: "created_at")
    var createdAt: Date

    @Field(key: "updated_at")
    var updatedAt: Date

    @Field(key: "expires_at")
    var expiresAt: Date

    init() {}

    init(
        id: UUID? = nil,
        tokenHash: String,
        accountDID: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        expiresAt: Date
    ) {
        self.id = id
        self.tokenHash = tokenHash
        self.accountDID = accountDID
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
    }
}
