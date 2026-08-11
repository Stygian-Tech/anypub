import Foundation
import Vapor

struct ScheduledPublisher {
    let publisher = PublisherService()

    func run(req: Request) async throws -> SchedulerRun {
        let started = Date()
        let due = try await Draft.query(on: req.db)
            .filter(\.$status, .equal, DraftStatus.scheduled.rawValue)
            .filter(\.$scheduledAt, .lessThanOrEqual, started)
            .all()

        var published = 0
        var failed = 0
        for draft in due {
            do {
                _ = try await publisher.publish(draft: draft, req: req)
                published += 1
            } catch {
                failed += 1
                req.logger.error("Scheduled publish failed for draft \(draft.id?.uuidString ?? "unknown"): \(String(describing: error))")
            }
        }

        let run = SchedulerRun(startedAt: started, finishedAt: Date(), publishedCount: published, failedCount: failed)
        try await run.save(on: req.db)
        return run
    }
}

final class ScheduledPublisherLifecycle: LifecycleHandler, @unchecked Sendable {
    private var task: Task<Void, Never>?

    func didBoot(_ application: Application) throws {
        guard application.environment != .testing else { return }
        task = Task {
            while !Task.isCancelled {
                let request = Request(application: application, on: application.eventLoopGroup.next())
                do {
                    let run = try await ScheduledPublisher().run(req: request)
                    application.logger.info("Scheduled publisher completed: \(run.publishedCount) published, \(run.failedCount) failed")
                } catch {
                    application.logger.error("Scheduled publisher tick failed: \(String(describing: error))")
                }
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    func shutdown(_ application: Application) {
        task?.cancel()
        task = nil
    }
}
