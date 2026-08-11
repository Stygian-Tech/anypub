import Vapor

struct AccountController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let accounts = routes.grouped("accounts")
        accounts.get(use: list)
        accounts.delete(":did", use: unlink)
    }

    func list(req: Request) async throws -> [AccountResponse] {
        try await LinkedAccount.query(on: req.db)
            .sort(\.$linkedAt, .descending)
            .all()
            .map(AccountResponse.init(account:))
    }

    func unlink(req: Request) async throws -> HTTPStatus {
        guard let did = req.parameters.get("did") else { throw Abort(.badRequest) }
        guard let account = try await LinkedAccount.query(on: req.db).filter(\.$did, .equal, did).first() else {
            throw Abort(.notFound)
        }
        try await account.delete(on: req.db)
        return .noContent
    }
}

struct AccountResponse: Content {
    let id: UUID?
    let did: String
    let handle: String
    let pdsURL: String
    let scope: String
    let linkedAt: Date
    let updatedAt: Date

    init(account: LinkedAccount) {
        id = account.id
        did = account.did
        handle = account.handle
        pdsURL = account.pdsURL
        scope = account.scope
        linkedAt = account.linkedAt
        updatedAt = account.updatedAt
    }
}
