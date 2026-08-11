import Vapor

struct PublicationController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let publications = routes.grouped("publications")
        publications.get(use: list)
        publications.post("sync", use: sync)
    }

    func list(req: Request) async throws -> [PublicationResponse] {
        let accountDID = try req.query.get(String.self, at: "accountDID")
        return try await PublicationCache.query(on: req.db)
            .filter(\.$accountDID, .equal, accountDID)
            .sort(\.$name)
            .all()
            .map(PublicationResponse.init(publication:))
    }

    func sync(req: Request) async throws -> [PublicationResponse] {
        let input = try req.content.decode(SyncPublicationsRequest.self)
        guard let account = try await LinkedAccount.query(on: req.db).filter(\.$did, .equal, input.accountDID).first() else {
            throw Abort(.notFound, reason: "Linked account not found")
        }
        return try await req.application.publicationDiscovery
            .sync(account: account, req: req)
            .map(PublicationResponse.init(publication:))
    }
}

struct SyncPublicationsRequest: Content {
    let accountDID: String
}

struct PublicationResponse: Content {
    let id: UUID?
    let accountDID: String
    let uri: String
    let cid: String?
    let name: String
    let url: String
    let description: String?
    let themeType: String?
    let themeName: String?
    let host: String?
    let syncedAt: Date

    init(publication: PublicationCache) {
        id = publication.id
        accountDID = publication.accountDID
        uri = publication.uri
        cid = publication.cid
        name = publication.name
        url = publication.url
        description = publication.publicationDescription
        themeType = publication.themeType
        themeName = publication.themeName
        host = publication.host
        syncedAt = publication.syncedAt
    }
}
