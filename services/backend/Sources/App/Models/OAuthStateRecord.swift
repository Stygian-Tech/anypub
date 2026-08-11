import Fluent
import Vapor

final class OAuthStateRecord: Model, Content, @unchecked Sendable {
    static let schema = "oauth_states"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "state")
    var state: String

    @Field(key: "handle")
    var handle: String

    @Field(key: "code_verifier")
    var codeVerifier: String

    @Field(key: "redirect_url")
    var redirectURL: String

    @OptionalField(key: "authorization_server")
    var authorizationServer: String?

    @OptionalField(key: "token_endpoint")
    var tokenEndpoint: String?

    @OptionalField(key: "pds_url")
    var pdsURL: String?

    @OptionalField(key: "dpop_key_json")
    var dpopKeyJSON: String?

    @OptionalField(key: "expected_did")
    var expectedDID: String?

    @Field(key: "created_at")
    var createdAt: Date

    @Field(key: "expires_at")
    var expiresAt: Date

    init() {}

    init(
        id: UUID? = nil,
        state: String,
        handle: String,
        codeVerifier: String,
        redirectURL: String,
        authorizationServer: String? = nil,
        tokenEndpoint: String? = nil,
        pdsURL: String? = nil,
        dpopKeyJSON: String? = nil,
        expectedDID: String? = nil,
        createdAt: Date = Date(),
        expiresAt: Date
    ) {
        self.id = id
        self.state = state
        self.handle = handle
        self.codeVerifier = codeVerifier
        self.redirectURL = redirectURL
        self.authorizationServer = authorizationServer
        self.tokenEndpoint = tokenEndpoint
        self.pdsURL = pdsURL
        self.dpopKeyJSON = dpopKeyJSON
        self.expectedDID = expectedDID
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }
}
