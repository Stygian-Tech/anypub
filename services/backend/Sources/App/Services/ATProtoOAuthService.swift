import Foundation
import NIOCore
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

struct OAuthCompletion: Sendable {
    let did: String
    let handle: String
    let pdsURL: String
    let tokenEndpoint: String
    let scope: String
    let accessToken: String
    let refreshToken: String
    let dpopKeyJSON: String
}

struct ATProtoOAuthService: Sendable {
    func clientMetadata(config: AppConfig) -> OAuthClientMetadata {
        OAuthClientMetadata(
            client_id: clientID(config),
            client_name: config.oauthClientName,
            client_uri: config.publicURL,
            logo_uri: config.oauthClientLogoURL,
            tos_uri: config.oauthClientTOSURL,
            policy_uri: config.oauthClientPolicyURL,
            redirect_uris: [callbackURL(config)],
            grant_types: ["authorization_code", "refresh_token"],
            scope: OAuthScopeBuilder.cmsScopes(),
            response_types: ["code"],
            application_type: "web",
            token_endpoint_auth_method: "none",
            dpop_bound_access_tokens: true
        )
    }

    func start(handle: String, redirectURL: String?, browserSessionID: UUID, req: Request) async throws -> OAuthStartResponse {
        let config = req.application.anypubConfig
        let normalizedHandle = try normalizeHandle(handle)
        let identity = try await resolveIdentity(normalizedHandle, client: req.client)
        let resource: ProtectedResourceMetadata = try await getJSON(
            "\(identity.pdsURL)/.well-known/oauth-protected-resource",
            client: req.client
        )
        guard let advertisedAuthorizationServer = resource.authorizationServers.first else {
            throw Abort(.badGateway, reason: "PDS OAuth metadata has no authorization server")
        }
        let authorizationServer = try validatedHTTPSOrigin(advertisedAuthorizationServer)
        let metadata: AuthorizationServerMetadata = try await getJSON(
            "\(authorizationServer)/.well-known/oauth-authorization-server",
            client: req.client
        )
        guard metadata.issuer == authorizationServer,
              metadata.scopesSupported.contains("atproto"),
              metadata.dpopAlgorithms.contains("ES256"),
              metadata.clientMetadataSupported
        else {
            throw Abort(.badGateway, reason: "Authorization server does not satisfy the AT Protocol OAuth profile")
        }
        _ = try validatedHTTPSEndpoint(metadata.authorizationEndpoint)
        _ = try validatedHTTPSEndpoint(metadata.tokenEndpoint)
        _ = try validatedHTTPSEndpoint(metadata.pushedAuthorizationRequestEndpoint)

        let state = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let verifier = PKCE.verifier()
        let challenge = PKCE.challenge(for: verifier)
        let dpopKey = DPoPKey()
        let parameters = [
            "client_id": clientID(config),
            "redirect_uri": callbackURL(config),
            "response_type": "code",
            "scope": OAuthScopeBuilder.cmsScopes(),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "login_hint": normalizedHandle,
        ]
        let parResponse: DPoPResponse<PARResponse> = try await postFormWithDPoP(
            metadata.pushedAuthorizationRequestEndpoint,
            values: parameters,
            dpopKey: dpopKey,
            client: req.client
        )
        let par = parResponse.value

        let targetRedirect = safeRedirect(redirectURL, config: config)
        let stateRecord = OAuthStateRecord(
            state: state,
            handle: normalizedHandle,
            codeVerifier: try req.application.tokenEncryption.seal(verifier),
            redirectURL: targetRedirect,
            authorizationServer: authorizationServer,
            tokenEndpoint: metadata.tokenEndpoint,
            pdsURL: identity.pdsURL,
            dpopKeyJSON: try req.application.tokenEncryption.seal(dpopKey.exportJSON()),
            expectedDID: identity.did,
            browserSessionID: browserSessionID,
            expiresAt: Date().addingTimeInterval(10 * 60)
        )
        try await stateRecord.save(on: req.db)

        var components = URLComponents(string: metadata.authorizationEndpoint)
        components?.queryItems = [
            URLQueryItem(name: "client_id", value: clientID(config)),
            URLQueryItem(name: "request_uri", value: par.requestURI),
        ]
        guard let authorizationURL = components?.url?.absoluteString else {
            throw Abort(.badGateway, reason: "Authorization server returned an invalid endpoint")
        }
        return OAuthStartResponse(
            state: state,
            scopes: OAuthScopeBuilder.cmsScopes(),
            authorizationURL: authorizationURL,
            codeChallenge: challenge,
            codeChallengeMethod: "S256"
        )
    }

    func complete(state: OAuthStateRecord, code: String, issuer: String, req: Request) async throws -> OAuthCompletion {
        guard let authorizationServer = state.authorizationServer,
              let tokenEndpoint = state.tokenEndpoint,
              let pdsURL = state.pdsURL,
              let encryptedKey = state.dpopKeyJSON,
              let expectedDID = state.expectedDID,
              issuer == authorizationServer
        else {
            throw Abort(.badRequest, reason: "OAuth callback issuer or state metadata is invalid")
        }
        let verifier = try req.application.tokenEncryption.open(state.codeVerifier)
        let dpopKeyJSON = try req.application.tokenEncryption.open(encryptedKey)
        let dpopKey = try DPoPKey(json: dpopKeyJSON)
        let tokenResponse: DPoPResponse<OAuthTokenResponse> = try await postFormWithDPoP(
            tokenEndpoint,
            values: [
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": callbackURL(req.application.anypubConfig),
                "client_id": clientID(req.application.anypubConfig),
                "code_verifier": verifier,
            ],
            dpopKey: dpopKey,
            client: req.client
        )
        let token = tokenResponse.value
        let scopes = Set(token.scope.split(separator: " ").map(String.init))
        guard token.tokenType.caseInsensitiveCompare("DPoP") == .orderedSame,
              scopes.contains("atproto"),
              token.subject == expectedDID,
              !token.accessToken.isEmpty
        else {
            throw Abort(.badGateway, reason: "Authorization server returned an invalid AT Protocol token")
        }
        if sameDPoPServer(tokenEndpoint, pdsURL) {
            await dpopNonces.set(
                tokenResponse.nonce,
                for: dpopNonceKey(accountDID: token.subject, serverURL: pdsURL)
            )
        }
        return OAuthCompletion(
            did: token.subject,
            handle: state.handle,
            pdsURL: pdsURL,
            tokenEndpoint: tokenEndpoint,
            scope: token.scope,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken ?? "",
            dpopKeyJSON: dpopKeyJSON
        )
    }

    private func resolveIdentity(_ handle: String, client: Client) async throws -> ResolvedIdentity {
        let did: String
        if handle.hasPrefix("did:plc:") {
            did = handle
        } else if let wellKnownDID = try? await resolveHandleWellKnown(handle, client: client) {
            did = wellKnownDID
        } else {
            let response: ResolveHandleResponse = try await getJSON(
                "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=\(urlComponent(handle))",
                client: client
            )
            did = response.did
        }
        let document: DIDDocument = try await getJSON(try didDocumentURL(did), client: client)
        guard let service = document.service.first(where: {
            $0.id.hasSuffix("#atproto_pds") || $0.type == "AtprotoPersonalDataServer"
        }) else {
            throw Abort(.badGateway, reason: "DID document does not declare an AT Protocol PDS")
        }
        let pdsURL = try validatedHTTPSOrigin(service.serviceEndpoint)
        return ResolvedIdentity(did: did, pdsURL: pdsURL)
    }

    private func resolveHandleWellKnown(_ handle: String, client: Client) async throws -> String {
        let response = try await client.get(URI(string: "https://\(handle)/.well-known/atproto-did")).get()
        guard response.status == .ok,
              let body = response.body,
              let did = body.getString(at: body.readerIndex, length: body.readableBytes)?.trimmingCharacters(in: .whitespacesAndNewlines),
              did.hasPrefix("did:plc:") || did.hasPrefix("did:web:")
        else { throw Abort(.badGateway, reason: "Handle well-known response is invalid") }
        return did
    }

    private func didDocumentURL(_ did: String) throws -> String {
        if did.hasPrefix("did:plc:") { return "https://plc.directory/\(did)" }
        if did.hasPrefix("did:web:") {
            let suffix = String(did.dropFirst("did:web:".count))
            let components = suffix.split(separator: ":").map(String.init)
            guard let host = components.first, !host.isEmpty else {
                throw Abort(.badGateway, reason: "Invalid did:web identifier")
            }
            let path = components.count == 1
                ? "/.well-known/did.json"
                : "/\(components.dropFirst().joined(separator: "/"))/did.json"
            return "https://\(host)\(path)"
        }
        throw Abort(.badGateway, reason: "Unsupported DID method")
    }

    private func getJSON<Value: Decodable>(_ url: String, client: Client) async throws -> Value {
        let response = try await client.get(URI(string: url)).get()
        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "OAuth discovery request failed")
        }
        return try decodeJSONBody(Value.self, from: response.body)
    }

    private func postFormWithDPoP<Value: Decodable>(
        _ url: String,
        values: [String: String],
        dpopKey: DPoPKey,
        client: Client
    ) async throws -> DPoPResponse<Value> {
        var nonce: String?
        for attempt in 0..<2 {
            let proof = try dpopKey.proof(httpMethod: "POST", url: url, nonce: nonce)
            let response = try await client.post(URI(string: url)) { request in
                request.headers.contentType = .urlEncodedForm
                request.headers.replaceOrAdd(name: "DPoP", value: proof)
                var buffer = ByteBufferAllocator().buffer(capacity: 512)
                buffer.writeString(formEncoded(values))
                request.body = buffer
            }.get()
            if (200..<300).contains(response.status.code) {
                guard let responseNonce = response.headers.first(name: "DPoP-Nonce") else {
                    throw Abort(.badGateway, reason: "OAuth server omitted its required DPoP nonce")
                }
                return DPoPResponse(
                    value: try response.content.decode(Value.self),
                    nonce: responseNonce
                )
            }
            if attempt == 0,
               oauthErrorName(response) == "use_dpop_nonce",
               let nextNonce = response.headers.first(name: "DPoP-Nonce") {
                nonce = nextNonce
                continue
            }
            throw Abort(.badGateway, reason: oauthErrorReason(response))
        }
        throw Abort(.badGateway, reason: "OAuth request failed")
    }

    private func normalizeHandle(_ value: String) throws -> String {
        let handle = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if handle.hasPrefix("did:plc:"), handle.count > 12 { return handle }
        let pattern = #"^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"#
        guard handle.range(of: pattern, options: .regularExpression) != nil else {
            throw Abort(.badRequest, reason: "Enter a valid AT Protocol handle or did:plc identifier")
        }
        return handle
    }

    private func validatedHTTPSOrigin(_ value: String) throws -> String {
        guard let components = URLComponents(string: value),
              components.scheme == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.path.isEmpty || components.path == "/",
              components.query == nil,
              components.fragment == nil
        else { throw Abort(.badGateway, reason: "OAuth metadata returned an invalid HTTPS origin") }
        return value.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func validatedHTTPSEndpoint(_ value: String) throws -> String {
        guard let components = URLComponents(string: value),
              components.scheme == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.fragment == nil
        else { throw Abort(.badGateway, reason: "OAuth metadata returned an invalid HTTPS endpoint") }
        return value
    }

    func safeRedirect(_ requested: String?, config: AppConfig) -> String {
        let editorURL = "\(config.webPublicURL)/editor"
        guard let requested,
              let requestedURL = URLComponents(string: requested),
              let webURL = URLComponents(string: config.webPublicURL),
              requestedURL.scheme == webURL.scheme,
              requestedURL.host == webURL.host,
              requestedURL.port == webURL.port,
              requestedURL.path == "/editor",
              requestedURL.user == nil,
              requestedURL.password == nil,
              requestedURL.fragment == nil
        else { return editorURL }
        return requested
    }

    private func clientID(_ config: AppConfig) -> String { "\(config.publicURL)/oauth/client-metadata.json" }
    private func callbackURL(_ config: AppConfig) -> String { "\(config.publicURL)/api/auth/atproto/callback" }
}

private struct DPoPResponse<Value> {
    let value: Value
    let nonce: String
}

private struct ResolvedIdentity { let did: String; let pdsURL: String }
private struct ResolveHandleResponse: Decodable { let did: String }
private struct DIDDocument: Decodable { let service: [DIDService] }
private struct DIDService: Decodable { let id: String; let type: String; let serviceEndpoint: String }

private struct ProtectedResourceMetadata: Decodable {
    let authorizationServers: [String]
    enum CodingKeys: String, CodingKey { case authorizationServers = "authorization_servers" }
}

private struct AuthorizationServerMetadata: Decodable {
    let issuer: String
    let authorizationEndpoint: String
    let tokenEndpoint: String
    let pushedAuthorizationRequestEndpoint: String
    let scopesSupported: [String]
    let dpopAlgorithms: [String]
    let clientMetadataSupported: Bool

    enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case pushedAuthorizationRequestEndpoint = "pushed_authorization_request_endpoint"
        case scopesSupported = "scopes_supported"
        case dpopAlgorithms = "dpop_signing_alg_values_supported"
        case clientMetadataSupported = "client_id_metadata_document_supported"
    }
}

private struct PARResponse: Decodable {
    let requestURI: String
    enum CodingKeys: String, CodingKey { case requestURI = "request_uri" }
}

struct OAuthTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let tokenType: String
    let scope: String
    let subject: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case scope
        case subject = "sub"
    }
}

private func oauthErrorReason(_ response: ClientResponse) -> String {
    guard var body = response.body,
          let value = body.readString(length: body.readableBytes),
          !value.isEmpty
    else { return "OAuth server rejected the request" }
    return "OAuth server rejected the request: \(String(value.prefix(300)))"
}

private func oauthErrorName(_ response: ClientResponse) -> String? {
    struct ErrorResponse: Decodable { let error: String }
    guard let body = response.body else { return nil }
    return try? JSONDecoder().decode(ErrorResponse.self, from: Data(body.readableBytesView)).error
}

private func urlComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
}

func decodeJSONBody<Value: Decodable>(_ type: Value.Type, from body: ByteBuffer?) throws -> Value {
    guard let body else {
        throw Abort(.badGateway, reason: "OAuth discovery returned an empty response")
    }
    return try JSONDecoder().decode(Value.self, from: Data(body.readableBytesView))
}
