import Vapor

struct ResearchController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        routes.get("research", use: show)
    }

    func show(req: Request) async throws -> ResearchResponse {
        let account = try await req.authenticatedContext().account
        return await req.application.research.load(account: account, req: req)
    }
}
