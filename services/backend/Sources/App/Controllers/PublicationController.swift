import Vapor

struct PublicationController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let publications = routes.grouped("publications")
        publications.get(use: list)
        publications.post("sync", use: sync)
    }

    func list(req: Request) async throws -> [PublicationResponse] {
        let accountDID = try req.query.get(String.self, at: "accountDID")
        let account = try await req.requireAccountDID(accountDID)
        return try await PublicationCache.query(on: req.db)
            .filter(\.$accountDID, .equal, accountDID)
            .sort(\.$name)
            .all()
            .map { PublicationResponse(publication: $0, pdsURL: account.pdsURL) }
    }

    func sync(req: Request) async throws -> [PublicationResponse] {
        let input = try req.content.decode(SyncPublicationsRequest.self)
        let account = try await req.requireAccountDID(input.accountDID)
        return try await req.application.publicationDiscovery
            .sync(account: account, req: req)
            .map { PublicationResponse(publication: $0, pdsURL: account.pdsURL) }
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
    let iconURL: String?
    let themeType: String?
    let themeName: String?
    let host: String?
    let syncedAt: Date

    init(publication: PublicationCache, pdsURL: String) {
        id = publication.id
        accountDID = publication.accountDID
        uri = publication.uri
        cid = publication.cid
        name = publication.name
        url = publication.url
        description = publication.publicationDescription
        iconURL = atprotoBlobURL(pdsURL: pdsURL, did: publication.accountDID, cid: publication.iconCID)
        themeType = publication.themeType
        themeName = publication.themeName
        host = publication.host
        syncedAt = publication.syncedAt
    }
}
