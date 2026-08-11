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

    func callback(req: Request) async throws -> Response {
        guard let state = req.query[String.self, at: "state"],
              let code = req.query[String.self, at: "code"],
              let issuer = req.query[String.self, at: "iss"]
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
        let completion = try await ATProtoOAuthService().complete(
            state: stateRecord,
            code: code,
            issuer: issuer,
            req: req
        )
        let encryption = req.application.tokenEncryption
        if let account = try await LinkedAccount.query(on: req.db)
            .filter(\.$did, .equal, completion.did)
            .first() {
            account.handle = completion.handle
            account.pdsURL = completion.pdsURL
            account.scope = completion.scope
            account.accessToken = try encryption.seal(completion.accessToken)
            account.refreshToken = try encryption.seal(completion.refreshToken)
            account.tokenEndpoint = completion.tokenEndpoint
            account.dpopKeyJSON = try encryption.seal(completion.dpopKeyJSON)
            account.updatedAt = Date()
            try await account.save(on: req.db)
        } else {
            let account = LinkedAccount(
                did: completion.did,
                handle: completion.handle,
                pdsURL: completion.pdsURL,
                scope: completion.scope,
                accessToken: try encryption.seal(completion.accessToken),
                refreshToken: try encryption.seal(completion.refreshToken),
                tokenEndpoint: completion.tokenEndpoint,
                dpopKeyJSON: try encryption.seal(completion.dpopKeyJSON)
            )
            try await account.save(on: req.db)
        }
        try await stateRecord.delete(on: req.db)
        return req.redirect(to: stateRecord.redirectURL)
    }
}

struct JWKSResponse: Content {
    let keys: [String]
}

struct OAuthStartRequest: Content {
    let handle: String
    let redirectURL: String?
}
