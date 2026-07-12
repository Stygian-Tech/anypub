import Vapor

struct CalendarController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let calendar = routes.grouped("calendar")
        calendar.get(use: list)
        calendar.post("run-scheduler", use: runScheduler)
    }

    func list(req: Request) async throws -> [CalendarItemResponse] {
        let drafts = try await Draft.query(on: req.db)
            .group(.or) { group in
                group.filter(\.$status, .equal, DraftStatus.scheduled.rawValue)
                group.filter(\.$status, .equal, DraftStatus.published.rawValue)
            }
            .sort(\.$scheduledAt)
            .all()
        return drafts.map(CalendarItemResponse.init(draft:))
    }

    func runScheduler(req: Request) async throws -> SchedulerRun {
        try await ScheduledPublisher().run(req: req)
    }
}

struct CalendarItemResponse: Content {
    let draftID: UUID?
    let title: String
    let status: String
    let date: Date?
    let publicationURI: String
    let documentURI: String?

    init(draft: Draft) {
        draftID = draft.id
        title = draft.title
        status = draft.status
        date = draft.publishedAt ?? draft.scheduledAt
        publicationURI = draft.publicationURI
        documentURI = draft.documentURI
    }
}
