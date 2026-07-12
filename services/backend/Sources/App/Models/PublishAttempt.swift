import Fluent
import Vapor

final class PublishAttempt: Model, Content, @unchecked Sendable {
    static let schema = "publish_attempts"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "draft_id")
    var draftID: UUID

    @Field(key: "status")
    var status: String

    @OptionalField(key: "message")
    var message: String?

    @Field(key: "created_at")
    var createdAt: Date

    init() {}

    init(id: UUID? = nil, draftID: UUID, status: String, message: String?, createdAt: Date = Date()) {
        self.id = id
        self.draftID = draftID
        self.status = status
        self.message = message
        self.createdAt = createdAt
    }
}
