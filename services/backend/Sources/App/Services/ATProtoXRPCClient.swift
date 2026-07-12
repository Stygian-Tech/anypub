import Foundation
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

struct PublicationRecordValue: Codable, Sendable {
    let type: String?
    let url: String
    let name: String
    let description: String?
    let theme: PublicationThemeReference?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case url
        case name
        case description
        case theme
    }
}

struct PublicationThemeReference: Codable, Sendable {
    let type: String?
    let uri: String?
    let name: String?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case uri
        case name
    }

    init(type: String?, uri: String?, name: String?) {
        self.type = type
        self.uri = uri
        self.name = name
    }

    init(from decoder: Decoder) throws {
        if let container = try? decoder.singleValueContainer(),
           let uri = try? container.decode(String.self) {
            type = nil
            self.uri = uri
            name = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decodeIfPresent(String.self, forKey: .type)
        uri = try container.decodeIfPresent(String.self, forKey: .uri)
        name = try container.decodeIfPresent(String.self, forKey: .name)
    }
}

struct CreateRecordResponse: Content, Sendable {
    let uri: String
    let cid: String
}

struct UploadBlobResponse: Content, Sendable {
    let blob: ATProtoBlobRef
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

struct ATProtoXRPCClient: Sendable {
    func listPublications(account: LinkedAccount, tokenEncryption: TokenEncryption, client: Client) async throws -> [RepositoryRecord<PublicationRecordValue>] {
        var all: [RepositoryRecord<PublicationRecordValue>] = []
        var cursor: String?

        repeat {
            var query = [
                "repo": account.did,
                "collection": "site.standard.publication",
                "limit": "100",
            ]
            if let cursor { query["cursor"] = cursor }
            let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.listRecords", query: query)
            let response = try await client.get(URI(string: uri)) { req in
                try authorize(req: &req, account: account, tokenEncryption: tokenEncryption)
            }.get()
            let page = try response.content.decode(ListRecordsResponse<PublicationRecordValue>.self)
            all.append(contentsOf: page.records)
            cursor = page.cursor
        } while cursor != nil

        return all
    }

    func createDocument(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        record: StandardSiteDocumentRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await createRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            collection: "site.standard.document",
            record: record,
            client: client
        )
    }

    func createCalendarEvent(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        record: CalendarEventRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        try await createRecord(
            account: account,
            tokenEncryption: tokenEncryption,
            collection: "community.lexicon.calendar.event",
            record: record,
            client: client
        )
    }

    func putCalendarEvent(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        rkey: String,
        record: CalendarEventRecord,
        client: Client
    ) async throws -> CreateRecordResponse {
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.putRecord")
        let input = PutRecordInput(repo: account.did, collection: "community.lexicon.calendar.event", rkey: rkey, record: record)
        let response = try await client.post(URI(string: uri)) { req in
            try authorize(req: &req, account: account, tokenEncryption: tokenEncryption)
            try req.content.encode(input)
        }.get()
        return try response.content.decode(CreateRecordResponse.self)
    }

    func uploadBlob(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        data: Data,
        mimeType: String,
        client: Client
    ) async throws -> ATProtoBlobRef {
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.uploadBlob")
        let response = try await client.post(URI(string: uri)) { req in
            try authorize(req: &req, account: account, tokenEncryption: tokenEncryption)
            let parts = mimeType.components(separatedBy: "/")
            req.headers.contentType = HTTPMediaType(type: parts.first ?? "application", subType: parts.dropFirst().first ?? "octet-stream")
            var buffer = ByteBufferAllocator().buffer(capacity: data.count)
            buffer.writeBytes(data)
            req.body = buffer
        }.get()
        return try response.content.decode(UploadBlobResponse.self).blob
    }

    private func createRecord<Record: Codable & Sendable>(
        account: LinkedAccount,
        tokenEncryption: TokenEncryption,
        collection: String,
        record: Record,
        client: Client
    ) async throws -> CreateRecordResponse {
        let uri = try xrpcURL(pdsURL: account.pdsURL, method: "com.atproto.repo.createRecord")
        let input = CreateRecordInput(repo: account.did, collection: collection, record: record)
        let response = try await client.post(URI(string: uri)) { req in
            try authorize(req: &req, account: account, tokenEncryption: tokenEncryption)
            try req.content.encode(input)
        }.get()
        return try response.content.decode(CreateRecordResponse.self)
    }

    private func authorize(req: inout ClientRequest, account: LinkedAccount, tokenEncryption: TokenEncryption) throws {
        let token = try tokenEncryption.open(account.accessToken)
        req.headers.add(name: .authorization, value: "DPoP \(token)")
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
