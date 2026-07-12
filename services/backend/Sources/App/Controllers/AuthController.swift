import Vapor

struct AuthController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        routes.get("oauth", "client-metadata.json", use: metadata)
        routes.get("oauth", "jwks.json", use: jwks)

        let auth = routes.grouped("api", "auth", "atproto")
        auth.post("start", use: start)
        auth.get("callback", use: callback)
    }

    func metadata(req: Request) async throws -> OAuthClientMetadata {
        ATProtoOAuthService().clientMetadata(config: req.application.anypubConfig)
    }

    func jwks(req: Request) async throws -> JWKSResponse {
        JWKSResponse(keys: [])
    }

    func start(req: Request) async throws -> OAuthStartResponse {
        let input = try req.content.decode(OAuthStartRequest.self)
        return try await ATProtoOAuthService().start(handle: input.handle, redirectURL: input.redirectURL, req: req)
    }

    func callback(req: Request) async throws -> OAuthCallbackResponse {
        guard let state = req.query[String.self, at: "state"],
              let code = req.query[String.self, at: "code"]
        else {
            throw Abort(.badRequest, reason: "Missing OAuth state or code")
        }
        guard let stateRecord = try await OAuthStateRecord.query(on: req.db).filter(\.$state, .equal, state).first() else {
            throw Abort(.badRequest, reason: "Unknown OAuth state")
        }
        guard stateRecord.expiresAt > Date() else {
            try await stateRecord.delete(on: req.db)
            throw Abort(.badRequest, reason: "OAuth state expired")
        }
        try await stateRecord.delete(on: req.db)
        return OAuthCallbackResponse(
            ok: true,
            state: state,
            code: code,
            handle: stateRecord.handle,
            redirectURL: stateRecord.redirectURL
        )
    }
}

struct JWKSResponse: Content {
    let keys: [String]
}

struct OAuthStartRequest: Content {
    let handle: String
    let redirectURL: String?
}

struct OAuthCallbackResponse: Content {
    let ok: Bool
    let state: String
    let code: String
    let handle: String
    let redirectURL: String
}
