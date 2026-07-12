import Fluent
import Vapor

final class CalendarEventLink: Model, Content, @unchecked Sendable {
    static let schema = "calendar_event_links"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "draft_id")
    var draftID: UUID

    @Field(key: "event_uri")
    var eventURI: String

    @OptionalField(key: "event_cid")
    var eventCID: String?

    @Field(key: "updated_at")
    var updatedAt: Date

    init() {}

    init(id: UUID? = nil, draftID: UUID, eventURI: String, eventCID: String?, updatedAt: Date = Date()) {
        self.id = id
        self.draftID = draftID
        self.eventURI = eventURI
        self.eventCID = eventCID
        self.updatedAt = updatedAt
    }
}
