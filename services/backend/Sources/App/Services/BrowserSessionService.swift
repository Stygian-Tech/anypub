import Crypto
import Fluent
import Foundation
import Vapor

struct BrowserSessionContext: Sendable {
    let session: BrowserSession
    let account: LinkedAccount
}

struct BrowserSessionService: Sendable {
    static let cookieName = "anypub_session"
    static let lifetime: TimeInterval = 60 * 60 * 24 * 30

    func create(req: Request) async throws -> (session: BrowserSession, token: String) {
        let token = Data((0..<32).map { _ in UInt8.random(in: .min ... .max) }).base64URLEncodedString()
        let now = Date()
        let session = BrowserSession(
            tokenHash: Self.hash(token),
            createdAt: now,
            updatedAt: now,
            expiresAt: now.addingTimeInterval(Self.lifetime)
        )
        try await session.save(on: req.db)
        return (session, token)
    }

    func session(req: Request) async throws -> BrowserSession? {
        guard let token = req.cookies[Self.cookieName]?.string, !token.isEmpty else { return nil }
        guard let session = try await BrowserSession.query(on: req.db)
            .filter(\.$tokenHash, .equal, Self.hash(token))
            .first()
        else { return nil }
        guard session.expiresAt > Date() else {
            try await session.delete(on: req.db)
            return nil
        }
        return session
    }

    func requireSession(req: Request) async throws -> BrowserSession {
        guard let session = try await session(req: req) else {
            throw Abort(.unauthorized, reason: "Sign in to continue")
        }
        return session
    }

    func requireAuthenticated(req: Request) async throws -> BrowserSessionContext {
        let session = try await requireSession(req: req)
        guard let accountDID = session.accountDID,
              let account = try await LinkedAccount.query(on: req.db)
                .filter(\.$did, .equal, accountDID)
                .first()
        else {
            throw Abort(.unauthorized, reason: "Sign in to continue")
        }
        return BrowserSessionContext(session: session, account: account)
    }

    func setCookie(_ token: String, on response: Response, req: Request) {
        response.cookies[Self.cookieName] = .init(
            string: token,
            expires: Date().addingTimeInterval(Self.lifetime),
            maxAge: Int(Self.lifetime),
            domain: nil,
            path: "/",
            isSecure: req.application.anypubConfig.publicURL.hasPrefix("https://"),
            isHTTPOnly: true,
            sameSite: .lax
        )
    }

    func clearCookie(on response: Response, req: Request) {
        response.cookies[Self.cookieName] = .init(
            string: "",
            expires: Date(timeIntervalSince1970: 0),
            maxAge: 0,
            domain: nil,
            path: "/",
            isSecure: req.application.anypubConfig.publicURL.hasPrefix("https://"),
            isHTTPOnly: true,
            sameSite: .lax
        )
    }

    static func hash(_ token: String) -> String {
        Data(SHA256.hash(data: Data(token.utf8))).base64EncodedString()
    }
}

struct BrowserSessionAuthenticator: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: any AsyncResponder) async throws -> Response {
        _ = try await BrowserSessionService().requireAuthenticated(req: request)
        return try await next.respond(to: request)
    }
}

extension Request {
    func authenticatedContext() async throws -> BrowserSessionContext {
        try await BrowserSessionService().requireAuthenticated(req: self)
    }

    func requireAccountDID(_ claimedDID: String) async throws -> LinkedAccount {
        let context = try await authenticatedContext()
        let account = context.account
        guard account.did == claimedDID else {
            throw Abort(.forbidden, reason: "The requested account does not belong to this session")
        }
        return account
    }
}
