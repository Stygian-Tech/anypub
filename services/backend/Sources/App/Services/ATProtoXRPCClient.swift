import Foundation
import Fluent
import NIOCore
import Vapor

struct RepositoryRecord<Value: Codable & Sendable>: Codable, Sendable {
    let uri: String
    let cid: String?
    let value: Value
}

struct ListRecordsResponse<Value: Codable & Sendable>: Codable, Sendable {
    let records: [RepositoryRecord<Value>]
    let cursor: String?
}

struct CreateRecordResponse: Content, Sendable {
    let uri: String
    let cid: String
}

struct UploadBlobResponse: Content, Sendable {
    let blob: ATProtoBlobRef
}

struct LatestCommitResponse: Content, Sendable {
    let cid: String
    let rev: String
}

struct CreateRecordInput<Record: Codable & Sendable>: Content, Sendable {
    let repo: String
    let collection: String
    let record: Record
}

struct PutRecordInput<Record: Codable & Sendable>: Content, Sendable {
    let repo: String
    let collection: String
    let rkey: String
    let record: Record
}

struct DeleteRecordInput: Content, Sendable {
    let repo: String
    let collection: String
    let rkey: String
}

struct ApplyWritesInput: Content, Sendable {
    let repo: String
    let validate: Bool?
    let writes: [ApplyWrite]
    let swapCommit: String?

    init(repo: String, validate: Bool? = nil, writes: [ApplyWrite], swapCommit: String? = nil) {
        self.repo = repo
        self.validate = validate
        self.writes = writes
        self.swapCommit = swapCommit
    }
}

struct ApplyWrite: Codable, Equatable, Sendable {
    enum Action: String, Codable, Sendable {
        case create = "com.atproto.repo.applyWrites#create"
        case update = "com.atproto.repo.applyWrites#update"
        case delete = "com.atproto.repo.applyWrites#delete"
    }

    let type: Action
    let collection: String
    let rkey: String
    let value: JSONValue?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case collection
        case rkey
        case value
    }
}

struct ApplyWritesResponse: Content, Sendable {
    let results: [ApplyWriteResult]?
}

struct ApplyWriteResult: Codable, Sendable {
    let uri: String?
    let cid: String?
}

private struct XRPCErrorResponse: Decodable {
    let error: String?
    let message: String?
}

struct PcktDocumentWriteResult: Sendable {
    let document: CreateRecordResponse
    let wrapper: CreateRecordResponse
}

struct OffprintDocumentWriteResult: Sendable {
    let document: CreateRecordResponse
    let wrapper: CreateRecordResponse
}

struct ATProtoXRPCClient: Sendable {
    func getAccountProfileRecord(
        account: LinkedAccount,
        client: Client
    ) async throws -> RepositoryRecord<JSONValue>? {
        let uri = try xrpcURL(
            pdsURL: account.pdsURL,
            method: "com.atproto.repo.getRecord",
            query: [
                "repo": account.did,
                "collection": "app.bsky.actor.profile",
                "rkey": "self",
            ]
        )
        let response = try await client.get(URI(string: uri)).get()
        if response.status == .notFound { return nil }
        try requireSuccess(response, operation: "account profile lookup")
        return try response.content.decode(RepositoryRecord<JSONValue>.self)
    }

    func listPublicationRecordsPage(
        account: LinkedAccount,
        cursor: String?,
        client: Client
    ) async throws -> ListRecordsResponse<JSONValue> {
        var query = [
            "repo": account.did,
            "collection": "site.standard.publication",
            "limit": "100",
        ]
        if let cursor { query["cursor"] = cursor }
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.listRecords", query: query)
        let response = try await client.get(URI(string: uri)).get()
        try requireSuccess(response, operation: "publication listing")
        return try response.content.decode(ListRecordsResponse<JSONValue>.self)
    }

    func getRecord(
        account: LinkedAccount,
        collection: String,
        rkey: String,
        client: Client
    ) async throws -> RepositoryRecord<JSONValue>? {
        let uri = try xrpcURL(
            pdsURL: account.pdsURL,
            method: "com.atproto.repo.getRecord",
            query: ["repo": account.did, "collection": collection, "rkey": rkey]
        )
        let response = try await client.get(URI(string: uri)).get()
        if response.status == .notFound { return nil }
        if response.status == .badRequest,
           let error = try? response.content.decode(XRPCErrorResponse.self),
           error.error == "RecordNotFound" {
            return nil
        }
        try requireSuccess(response, operation: "record lookup")
        return try response.content.decode(RepositoryRecord<JSONValue>.self)
    }

    func getLatestCommit(account: LinkedAccount, client: Client) async throws -> LatestCommitResponse {
        let uri = try xrpcURL(
            pdsURL: account.pdsURL,
            method: "com.atproto.sync.getLatestCommit",
            query: ["did": account.did]
        )
        let response = try await client.get(URI(string: uri)).get()
        try requireSuccess(response, operation: "repository head lookup")
        return try response.content.decode(LatestCommitResponse.self)
    }

    func createDocument(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        record: StandardSiteDocumentRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await createRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            collection: "site.standard.document",
            record: record,
            client: client
        )
    }

    func putDocument(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        rkey: String,
        record: StandardSiteDocumentRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await putRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            collection: "site.standard.document",
            rkey: rkey,
            record: record,
            client: client
        )
    }

    func createCalendarEvent(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        record: CalendarEventRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await createRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            collection: "community.lexicon.calendar.event",
            record: record,
            client: client
        )
    }

    func applyPcktDocumentWrites(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        rkey: String,
        document: StandardSiteDocumentRecord,
        pcktPublicationURI: String,
        documentExists: Bool,
        wrapperExists: Bool,
        swapCommit: String? = nil,
        client: Client
    ) async throws -> PcktDocumentWriteResult {
        let documentValue = try ATProtoRecordCID.jsonValue(document)
        let documentCID = try ATProtoRecordCID.string(for: documentValue)
        let documentURI = "at://\(account.did)/site.standard.document/\(rkey)"
        let wrapper = PcktDocumentRecord(
            document: StrongReference(uri: documentURI, cid: documentCID),
            site: pcktPublicationURI
        )
        let wrapperValue = try ATProtoRecordCID.jsonValue(wrapper)
        let wrapperCID = try ATProtoRecordCID.string(for: wrapperValue)
        let wrapperURI = "at://\(account.did)/blog.pckt.document/\(rkey)"
        let writes = [
            ApplyWrite(
                type: documentExists ? .update : .create,
                collection: "site.standard.document",
                rkey: rkey,
                value: documentValue
            ),
            ApplyWrite(
                type: wrapperExists ? .update : .create,
                collection: "blog.pckt.document",
                rkey: rkey,
                value: wrapperValue
            ),
        ]
        let response = try await applyWrites(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            writes: writes,
            swapCommit: swapCommit,
            client: client
        )
        if let results = response.results {
            guard results.count == 2,
                  results[0].uri == documentURI,
                  results[0].cid == documentCID,
                  results[1].uri == wrapperURI,
                  results[1].cid == wrapperCID
            else {
                throw Abort(.badGateway, reason: "PDS returned unexpected results for the atomic pckt document transaction")
            }
        }
        return PcktDocumentWriteResult(
            document: CreateRecordResponse(uri: documentURI, cid: documentCID),
            wrapper: CreateRecordResponse(uri: wrapperURI, cid: wrapperCID)
        )
    }

    func applyPcktDocumentDeletes(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        rkey: String,
        swapCommit: String? = nil,
        client: Client
    ) async throws {
        _ = try await applyWrites(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            writes: [
                ApplyWrite(type: .delete, collection: "blog.pckt.document", rkey: rkey, value: nil),
                ApplyWrite(type: .delete, collection: "site.standard.document", rkey: rkey, value: nil),
            ],
            swapCommit: swapCommit,
            client: client
        )
    }

    func applyOffprintDocumentWrites(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        documentRkey: String,
        wrapperRkey: String,
        document: StandardSiteDocumentRecord,
        documentExists: Bool,
        wrapperExists: Bool,
        swapCommit: String? = nil,
        client: Client
    ) async throws -> OffprintDocumentWriteResult {
        let documentValue = try ATProtoRecordCID.jsonValue(document)
        let documentCID = try ATProtoRecordCID.string(for: documentValue)
        let documentURI = "at://\(account.did)/site.standard.document/\(documentRkey)"
        let wrapper = OffprintArticleRecord(document: StrongReference(
            uri: documentURI,
            cid: documentCID,
            type: "com.atproto.repo.strongRef"
        ))
        let wrapperValue = try ATProtoRecordCID.jsonValue(wrapper)
        let wrapperCID = try ATProtoRecordCID.string(for: wrapperValue)
        let wrapperURI = "at://\(account.did)/app.offprint.document.article/\(wrapperRkey)"
        let writes = [
            ApplyWrite(
                type: documentExists ? .update : .create,
                collection: "site.standard.document",
                rkey: documentRkey,
                value: documentValue
            ),
            ApplyWrite(
                type: wrapperExists ? .update : .create,
                collection: "app.offprint.document.article",
                rkey: wrapperRkey,
                value: wrapperValue
            ),
        ]
        let response = try await applyWrites(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            writes: writes,
            swapCommit: swapCommit,
            client: client
        )
        if let results = response.results {
            guard results.count == 2,
                  results[0].uri == documentURI,
                  results[0].cid == documentCID,
                  results[1].uri == wrapperURI,
                  results[1].cid == wrapperCID
            else {
                throw Abort(.badGateway, reason: "PDS returned unexpected results for the atomic Offprint document transaction")
            }
        }
        return OffprintDocumentWriteResult(
            document: CreateRecordResponse(uri: documentURI, cid: documentCID),
            wrapper: CreateRecordResponse(uri: wrapperURI, cid: wrapperCID)
        )
    }

    func applyOffprintDocumentDeletes(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        documentRkey: String,
        wrapperRkey: String,
        swapCommit: String? = nil,
        client: Client
    ) async throws {
        _ = try await applyWrites(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            writes: [
                ApplyWrite(type: .delete, collection: "app.offprint.document.article", rkey: wrapperRkey, value: nil),
                ApplyWrite(type: .delete, collection: "site.standard.document", rkey: documentRkey, value: nil),
            ],
            swapCommit: swapCommit,
            client: client
        )
    }

    func recordExists(
        account: LinkedAccount,
        collection: String,
        rkey: String,
        client: Client
    ) async throws -> Bool {
        let uri = try xrpcURL(
            pdsURL: account.pdsURL,
            method: "com.atproto.repo.getRecord",
            query: ["repo": account.did, "collection": collection, "rkey": rkey]
        )
        let response = try await client.get(URI(string: uri)).get()
        if response.status == .notFound { return false }
        guard (200..<300).contains(response.status.code) else {
            throw Abort(.badGateway, reason: "PDS rejected record lookup")
        }
        return true
    }

    func putCalendarEvent(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        rkey: String,
        record: CalendarEventRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await putRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            collection: "community.lexicon.calendar.event",
            rkey: rkey,
            record: record,
            client: client
        )
    }

    func uploadBlob(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        data: Data,
        mimeType: String,
        client: Client
    ) async throws -> ATProtoBlobRef {
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.uploadBlob")
        let response = try await send(
            method: .POST, url: uri, account: account,
            tokenEncryption: tokenEncryption, database: database, client: client
        ) { req in
            let parts = mimeType.components(separatedBy: "/")
            req.headers.contentType = HTTPMediaType(type: parts.first ?? "application", subType: parts.dropFirst().first ?? "octet-stream")
            var buffer = ByteBufferAllocator().buffer(capacity: data.count)
            buffer.writeBytes(data)
            req.body = buffer
        }
        guard (200..<300).contains(response.status.code) else {
            throw Abort(.badGateway, reason: "PDS rejected blob upload")
        }
        return try response.content.decode(UploadBlobResponse.self).blob
    }

    func createUserInputDiscussion(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        record: UserInputDiscussionRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await createRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            collection: "app.userinput.discussion",
            record: record,
            client: client
        )
    }

    func putUserInputUpvote(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        rkey: String,
        record: UserInputUpvoteRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await putRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            database: database,
            collection: "app.userinput.upvote",
            rkey: rkey,
            record: record,
            client: client
        )
    }

    func deleteRecord(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        recordURI: String,
        client: Client
    ) async throws {
        let reference = try ATRecordReference(uri: recordURI)
        guard reference.repo == account.did else {
            throw Abort(.badRequest, reason: "Record does not belong to the linked account")
        }

        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.deleteRecord")
        let input = DeleteRecordInput(repo: reference.repo, collection: reference.collection, rkey: reference.rkey)
        let response = try await send(
            method: .POST, url: uri, account: account,
            tokenEncryption: tokenEncryption, database: database, client: client
        ) { req in
            try req.content.encode(input)
        }
        guard (200..<300).contains(response.status.code) else {
            throw Abort(.badGateway, reason: "PDS rejected record deletion")
        }
    }

    private func createRecord<Record: Codable & Sendable>(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        collection: String,
        record: Record,
        client: Client
    ) async throws -> CreateRecordResponse {
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.createRecord")
        let input = CreateRecordInput(repo: account.did, collection: collection, record: record)
        let response = try await send(
            method: .POST, url: uri, account: account,
            tokenEncryption: tokenEncryption, database: database, client: client
        ) { req in
            try req.content.encode(input)
        }
        guard (200..<300).contains(response.status.code) else {
            throw Abort(.badGateway, reason: "PDS rejected record creation")
        }
        return try response.content.decode(CreateRecordResponse.self)
    }

    private func putRecord<Record: Codable & Sendable>(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        collection: String,
        rkey: String,
        record: Record,
        client: Client
    ) async throws -> CreateRecordResponse {
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.putRecord")
        let input = PutRecordInput(repo: account.did, collection: collection, rkey: rkey, record: record)
        let response = try await send(
            method: .POST, url: uri, account: account,
            tokenEncryption: tokenEncryption, database: database, client: client
        ) { req in
            try req.content.encode(input)
        }
        guard (200..<300).contains(response.status.code) else {
            throw Abort(.badGateway, reason: "PDS rejected record update")
        }
        return try response.content.decode(CreateRecordResponse.self)
    }

    private func applyWrites(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        writes: [ApplyWrite],
        swapCommit: String? = nil,
        client: Client
    ) async throws -> ApplyWritesResponse {
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.applyWrites")
        let input = ApplyWritesInput(repo: account.did, writes: writes, swapCommit: swapCommit)
        let response = try await send(
            method: .POST, url: uri, account: account,
            tokenEncryption: tokenEncryption, database: database, client: client
        ) { request in
            try request.content.encode(input)
        }
        if response.status == .badRequest,
           let error = try? response.content.decode(XRPCErrorResponse.self),
           error.error == "InvalidSwap" {
            throw Abort(
                .conflict,
                reason: error.message ?? "The repository changed during publishing; retry the operation"
            )
        }
        guard (200..<300).contains(response.status.code) else {
            throw Abort(.badGateway, reason: "PDS rejected the atomic repository transaction")
        }
        return try response.content.decode(ApplyWritesResponse.self)
    }

    private func send(
        method: HTTPMethod,
        url: String,
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        client: Client,
        configure: @escaping @Sendable (inout ClientRequest) throws -> Void = { _ in }
    ) async throws -> ClientResponse {
        guard let encryptedKey = account.dpopKeyJSON else {
            throw Abort(.conflict, reason: "Linked account must be reauthorized for DPoP publishing")
        }
        let dpopKey = try DPoPKey(json: tokenEncryption.open(encryptedKey))
        var accessToken = try tokenEncryption.open(account.accessToken)
        var refreshed = false
        let nonceKey = dpopNonceKey(accountDID: account.did, serverURL: url)

        for _ in 0..<4 {
            let nonce = await dpopNonces.nonce(for: nonceKey)
            let proof = try dpopKey.proof(httpMethod: method.rawValue, url: url, accessToken: accessToken, nonce: nonce)
            let response: ClientResponse
            switch method {
            case .GET:
                response = try await client.get(URI(string: url)) { request in
                    request.headers.replaceOrAdd(name: .authorization, value: "DPoP \(accessToken)")
                    request.headers.replaceOrAdd(name: "DPoP", value: proof)
                    try configure(&request)
                }.get()
            case .POST:
                response = try await client.post(URI(string: url)) { request in
                    request.headers.replaceOrAdd(name: .authorization, value: "DPoP \(accessToken)")
                    request.headers.replaceOrAdd(name: "DPoP", value: proof)
                    try configure(&request)
                }.get()
            default:
                throw Abort(.internalServerError, reason: "Unsupported authenticated HTTP method")
            }

            guard let responseNonce = response.headers.first(name: "DPoP-Nonce") else {
                throw Abort(.badGateway, reason: "PDS omitted its required DPoP nonce")
            }
            if responseNonce != nonce {
                await dpopNonces.set(responseNonce, for: nonceKey)
                if response.status == .badRequest || response.status == .unauthorized { continue }
            }
            if response.status == .unauthorized, !refreshed {
                accessToken = try await refresh(
                    account: account,
                    tokenEncryption: tokenEncryption,
                    database: database,
                    client: client,
                    dpopKey: dpopKey
                )
                refreshed = true
                continue
            }
            return response
        }
        throw Abort(.badGateway, reason: "PDS authentication failed after DPoP nonce and token refresh retries")
    }

    private func refresh(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        client: Client,
        dpopKey: DPoPKey
    ) async throws -> String {
        try await tokenRefreshCoordinator.run(for: account.did) {
            try await performRefresh(
                account: account,
                tokenEncryption: tokenEncryption,
                database: database,
                client: client,
                dpopKey: dpopKey
            )
        }
    }

    private func performRefresh(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        database: Database,
        client: Client,
        dpopKey: DPoPKey
    ) async throws -> String {
        guard let tokenEndpoint = account.tokenEndpoint,
              !tokenEndpoint.isEmpty
        else { throw Abort(.conflict, reason: "Linked account must be reauthorized before its token can refresh") }
        let refreshToken = try tokenEncryption.open(account.refreshToken)
        guard !refreshToken.isEmpty else {
            throw Abort(.conflict, reason: "Linked account has no refresh token; reconnect it")
        }
        let body = formEncoded([
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": "\(AppConfig.load().publicURL)/oauth/client-metadata.json",
        ])
        var nonce: String?
        for attempt in 0..<2 {
            let proof = try dpopKey.proof(httpMethod: "POST", url: tokenEndpoint, nonce: nonce)
            let response = try await client.post(URI(string: tokenEndpoint)) { request in
                request.headers.contentType = .urlEncodedForm
                request.headers.replaceOrAdd(name: "DPoP", value: proof)
                var buffer = ByteBufferAllocator().buffer(capacity: body.utf8.count)
                buffer.writeString(body)
                request.body = buffer
            }.get()
            if (200..<300).contains(response.status.code) {
                guard let responseNonce = response.headers.first(name: "DPoP-Nonce") else {
                    throw Abort(.badGateway, reason: "Authorization server omitted its required DPoP nonce")
                }
                let token = try response.content.decode(OAuthTokenResponse.self)
                guard token.tokenType.caseInsensitiveCompare("DPoP") == .orderedSame,
                      token.subject == account.did,
                      token.scope.split(separator: " ").contains("atproto")
                else { throw Abort(.badGateway, reason: "Authorization server returned an invalid refreshed token") }
                account.accessToken = try tokenEncryption.seal(token.accessToken)
                account.refreshToken = try tokenEncryption.seal(token.refreshToken ?? refreshToken)
                account.scope = token.scope
                account.updatedAt = Date()
                try await account.save(on: database)
                if sameDPoPServer(account.tokenEndpoint, account.pdsURL) {
                    await dpopNonces.set(
                        responseNonce,
                        for: dpopNonceKey(accountDID: account.did, serverURL: account.pdsURL)
                    )
                }
                return token.accessToken
            }
            if attempt == 0, let nextNonce = response.headers.first(name: "DPoP-Nonce") {
                nonce = nextNonce
                continue
            }
            throw Abort(.conflict, reason: "Linked account token refresh failed; reconnect it")
        }
        throw Abort(.conflict, reason: "Linked account token refresh failed; reconnect it")
    }

    private func requireSuccess(_ response: ClientResponse, operation: String) throws {
        guard (200..<300).contains(response.status.code) else {
            throw Abort(.badGateway, reason: "PDS rejected \(operation)")
        }
    }

    private func xrpcURL(pdsURL: String, method: String, query: [String: String] = [:]) throws -> String {
        var components = URLComponents(string: "\(pdsURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/xrpc/\(method)")
        if !query.isEmpty {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url?.absoluteString else {
            throw Abort(.badRequest, reason: "Invalid PDS URL")
        }
        return url
    }
}

let dpopNonces = DPoPNonceStore()
private let tokenRefreshCoordinator = TokenRefreshCoordinator()

actor DPoPNonceStore {
    private var values: [String: String] = [:]
    func nonce(for key: String) -> String? { values[key] }
    func set(_ nonce: String, for key: String) { values[key] = nonce }
    func remove(for key: String) { values[key] = nil }
}

func dpopNonceKey(accountDID: String, serverURL: String) -> String {
    "\(accountDID)|\(dpopServerOrigin(serverURL) ?? serverURL)"
}

func sameDPoPServer(_ lhs: String?, _ rhs: String?) -> Bool {
    guard let lhs, let rhs,
          let lhsOrigin = dpopServerOrigin(lhs),
          let rhsOrigin = dpopServerOrigin(rhs)
    else { return false }
    return lhsOrigin == rhsOrigin
}

private func dpopServerOrigin(_ value: String) -> String? {
    guard let components = URLComponents(string: value),
          let scheme = components.scheme?.lowercased(),
          let host = components.host?.lowercased()
    else { return nil }
    let port = components.port.map { ":\($0)" } ?? ""
    return "\(scheme)://\(host)\(port)"
}

private actor TokenRefreshCoordinator {
    private var tasks: [String: Task<String, Error>] = [:]

    func run(
        for did: String,
        operation: @escaping @Sendable () async throws -> String
    ) async throws -> String {
        if let task = tasks[did] { return try await task.value }
        let task = Task { try await operation() }
        tasks[did] = task
        defer { tasks[did] = nil }
        return try await task.value
    }
}

struct ATRecordReference: Equatable, Sendable {
    let repo: String
    let collection: String
    let rkey: String

    init(uri: String) throws {
        guard uri.hasPrefix("at://") else {
            throw Abort(.badRequest, reason: "Invalid AT URI")
        }
        let parts = uri.dropFirst(5).split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count == 3 else {
            throw Abort(.badRequest, reason: "Invalid record AT URI")
        }
        repo = String(parts[0])
        collection = String(parts[1])
        rkey = String(parts[2])
    }
}
