import Vapor

struct AccountController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let accounts = routes.grouped("accounts")
        accounts.get(use: list)
        accounts.delete(":did", use: unlink)
    }

    func list(req: Request) async throws -> [AccountResponse] {
        let accounts = try await LinkedAccount.query(on: req.db)
            .sort(\.$linkedAt, .descending)
            .all()

        for account in accounts {
            do {
                try await req.application.accountProfileDiscovery.sync(account: account, req: req)
            } catch {
                req.logger.warning("Account profile refresh failed; returning cached identity", metadata: [
                    "accountDID": "\(account.did)",
                    "error": "\(error)",
                ])
            }
        }
        return accounts.map(AccountResponse.init(account:))
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
    let displayName: String?
    let avatarURL: String?
    let pdsURL: String
    let scope: String
    let linkedAt: Date
    let updatedAt: Date

    init(account: LinkedAccount) {
        id = account.id
        did = account.did
        handle = account.handle
        displayName = account.displayName
        avatarURL = atprotoBlobURL(pdsURL: account.pdsURL, did: account.did, cid: account.avatarCID)
        pdsURL = account.pdsURL
        scope = account.scope
        linkedAt = account.linkedAt
        updatedAt = account.updatedAt
    }
}
