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
        let records = try await ATProtoXRPCClient().listPublications(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            client: req.client
        )

        for record in records {
            let host = PublicationHostDetector.detect(
                themeType: record.value.theme?.type,
                themeName: record.value.theme?.name,
                publicationURL: record.value.url
            )

            if let existing = try await PublicationCache.query(on: req.db)
                .filter(\.$accountDID, .equal, account.did)
                .filter(\.$uri, .equal, record.uri)
                .first() {
                existing.cid = record.cid
                existing.name = record.value.name
                existing.url = record.value.url
                existing.publicationDescription = record.value.description
                existing.themeType = record.value.theme?.type
                existing.themeName = record.value.theme?.name
                existing.host = host?.rawValue
                existing.syncedAt = Date()
                try await existing.save(on: req.db)
            } else {
                try await PublicationCache(
                    accountDID: account.did,
                    uri: record.uri,
                    cid: record.cid,
                    name: record.value.name,
                    url: record.value.url,
                    publicationDescription: record.value.description,
                    themeType: record.value.theme?.type,
                    themeName: record.value.theme?.name,
                    host: host
                ).save(on: req.db)
            }
        }

        return try await list(req: req)
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
