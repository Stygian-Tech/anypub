import Vapor

struct AccountController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let accounts = routes.grouped("accounts")
        accounts.get(use: list)
        accounts.post(use: link)
        accounts.delete(":did", use: unlink)
    }

    func list(req: Request) async throws -> [AccountResponse] {
        try await LinkedAccount.query(on: req.db)
            .sort(\.$linkedAt, .descending)
            .all()
            .map(AccountResponse.init(account:))
    }

    func link(req: Request) async throws -> AccountResponse {
        let input = try req.content.decode(LinkAccountRequest.self)
        let encryption = req.application.tokenEncryption
        if let existing = try await LinkedAccount.query(on: req.db).filter(\.$did, .equal, input.did).first() {
            existing.handle = input.handle
            existing.pdsURL = input.pdsURL
            existing.scope = input.scope
            existing.accessToken = try encryption.seal(input.accessToken)
            existing.refreshToken = try encryption.seal(input.refreshToken)
            existing.updatedAt = Date()
            try await existing.save(on: req.db)
            return AccountResponse(account: existing)
        }
        let account = LinkedAccount(
            did: input.did,
            handle: input.handle,
            pdsURL: input.pdsURL,
            scope: input.scope,
            accessToken: try encryption.seal(input.accessToken),
            refreshToken: try encryption.seal(input.refreshToken)
        )
        try await account.save(on: req.db)
        return AccountResponse(account: account)
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

struct LinkAccountRequest: Content {
    let did: String
    let handle: String
    let pdsURL: String
    let accessToken: String
    let refreshToken: String
    let scope: String
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
