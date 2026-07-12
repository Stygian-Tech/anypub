import Vapor

struct UnsplashController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let unsplash = routes.grouped("unsplash")
        unsplash.get("search", use: search)
        unsplash.post("select", use: select)
    }

    func search(req: Request) async throws -> UnsplashSearchResponse {
        let query = try req.query.get(String.self, at: "q")
        let page = (try? req.query.get(Int.self, at: "page")) ?? 1
        return try await UnsplashService().search(query: query, page: page, req: req)
    }

    func select(req: Request) async throws -> CoverAsset {
        let input = try req.content.decode(UnsplashSelectRequest.self)
        return try await UnsplashService().select(input: input, req: req)
    }
}
