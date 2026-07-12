import Fluent
import Vapor

final class SchedulerRun: Model, Content, @unchecked Sendable {
    static let schema = "scheduler_runs"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "started_at")
    var startedAt: Date

    @Field(key: "finished_at")
    var finishedAt: Date

    @Field(key: "published_count")
    var publishedCount: Int

    @Field(key: "failed_count")
    var failedCount: Int

    init() {}

    init(
        id: UUID? = nil,
        startedAt: Date,
        finishedAt: Date,
        publishedCount: Int,
        failedCount: Int
    ) {
        self.id = id
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.publishedCount = publishedCount
        self.failedCount = failedCount
    }
}
