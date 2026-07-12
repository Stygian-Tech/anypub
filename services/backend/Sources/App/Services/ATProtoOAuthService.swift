import Foundation
import Vapor

struct OAuthClientMetadata: Content {
    let client_id: String
    let client_name: String
    let client_uri: String
    let logo_uri: String?
    let tos_uri: String?
    let policy_uri: String?
    let redirect_uris: [String]
    let grant_types: [String]
    let scope: String
    let response_types: [String]
    let application_type: String
    let token_endpoint_auth_method: String
    let dpop_bound_access_tokens: Bool
}

struct OAuthStartResponse: Content {
    let state: String
    let scopes: String
    let authorizationURL: String
    let codeChallenge: String
    let codeChallengeMethod: String
}

struct ATProtoOAuthService: Sendable {
    func clientMetadata(config: AppConfig) -> OAuthClientMetadata {
        OAuthClientMetadata(
            client_id: "\(config.publicURL)/oauth/client-metadata.json",
            client_name: config.oauthClientName,
            client_uri: config.publicURL,
            logo_uri: config.oauthClientLogoURL,
            tos_uri: config.oauthClientTOSURL,
            policy_uri: config.oauthClientPolicyURL,
            redirect_uris: ["\(config.publicURL)/api/auth/atproto/callback"],
            grant_types: ["authorization_code", "refresh_token"],
            scope: OAuthScopeBuilder.cmsScopes(),
            response_types: ["code"],
            application_type: "web",
            token_endpoint_auth_method: "none",
            dpop_bound_access_tokens: true
        )
    }

    func start(handle: String, redirectURL: String?, req: Request) async throws -> OAuthStartResponse {
        let state = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let verifier = PKCE.verifier()
        let challenge = PKCE.challenge(for: verifier)
        let callbackURL = "\(req.application.anypubConfig.publicURL)/api/auth/atproto/callback"
        let targetRedirect = redirectURL ?? "\(req.application.anypubConfig.publicURL)/"
        let record = OAuthStateRecord(
            state: state,
            handle: handle,
            codeVerifier: try req.application.tokenEncryption.seal(verifier),
            redirectURL: targetRedirect,
            expiresAt: Date().addingTimeInterval(60 * 60)
        )
        try await record.save(on: req.db)

        var components = URLComponents(string: "https://bsky.social/oauth/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: "\(req.application.anypubConfig.publicURL)/oauth/client-metadata.json"),
            URLQueryItem(name: "redirect_uri", value: callbackURL),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: OAuthScopeBuilder.cmsScopes()),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "login_hint", value: handle),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]

        return OAuthStartResponse(
            state: state,
            scopes: OAuthScopeBuilder.cmsScopes(),
            authorizationURL: components.url?.absoluteString ?? "",
            codeChallenge: challenge,
            codeChallengeMethod: "S256"
        )
    }
}
