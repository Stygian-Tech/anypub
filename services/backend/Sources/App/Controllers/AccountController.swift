import Vapor

struct AccountController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let accounts = routes.grouped("accounts")
        accounts.get(use: list)
        accounts.delete(":did", use: unlink)
    }

    func list(req: Request) async throws -> [AccountResponse] {
        let account = try await req.authenticatedContext().account
        do {
            try await req.application.accountProfileDiscovery.sync(account: account, req: req)
        } catch {
            req.logger.warning("Account profile refresh failed; returning cached identity", metadata: [
                "accountDID": "\(account.did)",
                "error": "\(error)",
            ])
        }
        return [AccountResponse(account: account)]
    }

    func unlink(req: Request) async throws -> Response {
        guard let did = req.parameters.get("did") else { throw Abort(.badRequest) }
        let context = try await req.authenticatedContext()
        guard context.account.did == did else {
            throw Abort(.forbidden, reason: "The requested account does not belong to this session")
        }
        try await context.session.delete(on: req.db)
        let response = Response(status: .noContent)
        BrowserSessionService().clearCookie(on: response, req: req)
        return response
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
