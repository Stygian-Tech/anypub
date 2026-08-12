import Vapor

struct FeedbackController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let feedback = routes.grouped("feedback")
        feedback.get("board", use: board)
        feedback.post(use: create)
    }

    func board(req: Request) async throws -> FeedbackBoardResponse {
        _ = try await req.authenticatedContext()
        return try await FeedbackService().board(req: req)
    }

    func create(req: Request) async throws -> FeedbackSubmissionResponse {
        let account = try await req.authenticatedContext().account
        let input = try req.content.decode(FeedbackSubmissionRequest.self)
        return try await FeedbackService().create(input: input, account: account, req: req)
    }
}

struct FeedbackSubmissionRequest: Content, Sendable {
    let title: String
    let body: String?
    let tags: [String]
    let assetIDs: [UUID]
}

struct FeedbackSubmissionResponse: Content, Sendable {
    let uri: String
    let cid: String
    let url: String
}
