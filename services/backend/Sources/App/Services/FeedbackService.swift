import Foundation
import Vapor

struct FeedbackBoardResponse: Content, Equatable, Sendable {
    struct Tag: Content, Equatable, Sendable {
        let label: String
        let value: String
    }

    let name: String
    let uri: String
    let tags: [Tag]
    let publicURL: String
}

private struct UserInputBoardEnvelope: Decodable {
    struct Board: Decodable {
        struct Value: Decodable {
            let name: String
            let tags: [FeedbackBoardResponse.Tag]?
        }

        let uri: String
        let cid: String
        let value: Value
    }

    let board: Board
}

struct FeedbackService: Sendable {
    static let boardURI = "at://did:plc:qy5pluw2bsuq2x6albsgkvx3/app.userinput.space/3msw5mogjcr2x"
    static let publicBoardURL = "https://userinput.app/s/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msw5mogjcr2x?lang=en"
    static let boardAPIURL = "https://userinput.app/api/board/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msw5mogjcr2x"
    static let missingPermissionMessage = "Your session does not include feedback permissions yet. Sign out and sign back in, then try again."

    private let xrpc = ATProtoXRPCClient()

    func board(req: Request) async throws -> FeedbackBoardResponse {
        let resolved = try await resolveBoard(req: req)
        return FeedbackBoardResponse(
            name: resolved.value.name,
            uri: resolved.uri,
            tags: resolved.value.tags ?? [],
            publicURL: Self.publicBoardURL
        )
    }

    func create(
        input: FeedbackSubmissionRequest,
        account: LinkedAccount,
        req: Request
    ) async throws -> FeedbackSubmissionResponse {
        guard Self.canCreateDiscussion(scope: account.scope) else {
            throw Abort(.forbidden, reason: Self.missingPermissionMessage)
        }

        let title = input.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            throw Abort(.unprocessableEntity, reason: "Add a title for your feedback")
        }
        guard title.count <= 200 else {
            throw Abort(.unprocessableEntity, reason: "Feedback titles must be 200 characters or fewer")
        }
        let body = input.body?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (body?.count ?? 0) <= 10_000 else {
            throw Abort(.unprocessableEntity, reason: "Feedback details must be 10,000 characters or fewer")
        }
        guard input.assetIDs.count <= 4, Set(input.assetIDs).count == input.assetIDs.count else {
            throw Abort(.unprocessableEntity, reason: "Attach up to four unique images")
        }
        let resolved = try await resolveBoard(req: req)
        let allowedTags = Set((resolved.value.tags ?? []).map(\.value))
        let tags = input.tags.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard Set(tags).count == tags.count, tags.allSatisfy(allowedTags.contains) else {
            throw Abort(.unprocessableEntity, reason: "Select only tags configured on the feedback board")
        }

        var images: [UserInputDiscussionRecord.Image] = []
        for assetID in input.assetIDs {
            guard let asset = try await CoverAsset.query(on: req.db)
                .filter(\.$id, .equal, assetID)
                .filter(\.$accountDID, .equal, account.did)
                .first(), asset.mimeType.hasPrefix("image/")
            else {
                throw Abort(.unprocessableEntity, reason: "A selected feedback image is unavailable")
            }
            guard Self.canUploadBlob(scope: account.scope, mimeType: asset.mimeType) else {
                throw Abort(.forbidden, reason: Self.missingPermissionMessage)
            }
            let blob = try await blob(for: asset, account: account, req: req)
            images.append(.init(image: blob, alt: asset.altText ?? "Feedback image"))
        }

        let createdAt = ATProtoTimestamp(Date())
        let discussion = try await xrpc.createUserInputDiscussion(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            database: req.db,
            record: UserInputDiscussionRecord(
                space: StrongReference(uri: resolved.uri, cid: resolved.cid),
                title: title,
                body: body.flatMap { $0.isEmpty ? nil : $0 },
                tags: tags.isEmpty ? nil : tags,
                images: images.isEmpty ? nil : images,
                createdAt: createdAt
            ),
            client: req.client
        )

        if let rkey = discussion.uri.split(separator: "/").last.map(String.init) {
            do {
                _ = try await xrpc.putUserInputUpvote(
                    account: account,
                    tokenEncryption: req.application.tokenEncryption,
                    database: req.db,
                    rkey: rkey,
                    record: UserInputUpvoteRecord(
                        subject: StrongReference(uri: discussion.uri, cid: discussion.cid),
                        createdAt: createdAt
                    ),
                    client: req.client
                )
            } catch {
                req.logger.warning("Could not add the initial feedback upvote: \(error)")
            }
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
            let did = account.did.addingPercentEncoding(withAllowedCharacters: allowed) ?? account.did
            let encodedRkey = rkey.addingPercentEncoding(withAllowedCharacters: allowed) ?? rkey
            return FeedbackSubmissionResponse(
                uri: discussion.uri,
                cid: discussion.cid,
                url: "https://userinput.app/d/\(did)/\(encodedRkey)?lang=en"
            )
        }
        throw Abort(.badGateway, reason: "The PDS returned an invalid feedback record URI")
    }

    static func canCreateDiscussion(scope: String) -> Bool {
        let scopes = scope.split(whereSeparator: \.isWhitespace).map(String.init)
        return scopes.contains(where: { $0.split(separator: "?", maxSplits: 1).first == "include:app.userinput.authFull" })
            || scopes.contains(where: { scopeAllowsRepoCreate($0, collection: "app.userinput.discussion") })
    }

    static func canUploadBlob(scope: String, mimeType: String) -> Bool {
        let scopes = scope.split(whereSeparator: \.isWhitespace).map(String.init)
        let mimeParts = mimeType.split(separator: "/", maxSplits: 1).map(String.init)
        guard mimeParts.count == 2 else { return false }
        return scopes.contains { token in
            let parts = token.split(separator: "?", maxSplits: 1).map(String.init)
            let patterns: [String]
            if parts[0].hasPrefix("blob:") {
                patterns = [String(parts[0].dropFirst("blob:".count))]
            } else if parts[0] == "blob", parts.count == 2 {
                patterns = queryValues(parts[1], named: "accept")
            } else {
                patterns = []
            }
            return patterns.contains { pattern in
                let patternParts = pattern.split(separator: "/", maxSplits: 1).map(String.init)
                return patternParts.count == 2
                    && (patternParts[0] == "*" || patternParts[0] == mimeParts[0])
                    && (patternParts[1] == "*" || patternParts[1] == mimeParts[1])
            }
        }
    }

    private static func scopeAllowsRepoCreate(_ token: String, collection: String) -> Bool {
        let parts = token.split(separator: "?", maxSplits: 1).map(String.init)
        let name = parts[0]
        let query = parts.count == 2 ? parts[1] : ""
        let allowsCollection = name == "repo:\(collection)"
            || name == "repo:*"
            || (name == "repo" && queryValues(query, named: "collection").contains(where: { $0 == collection || $0 == "*" }))
        guard allowsCollection else { return false }
        let actions = queryValues(query, named: "action")
        return actions.isEmpty || actions.contains("create")
    }

    private static func queryValues(_ query: String, named name: String) -> [String] {
        URLComponents(string: "https://scope.invalid/?\(query)")?.queryItems?
            .filter { $0.name == name }
            .compactMap(\.value) ?? []
    }

    private func resolveBoard(req: Request) async throws -> UserInputBoardEnvelope.Board {
        let response = try await req.client.get(URI(string: Self.boardAPIURL)).get()
        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "The feedback board is temporarily unavailable")
        }
        let envelope = try response.content.decode(UserInputBoardEnvelope.self)
        guard envelope.board.uri == Self.boardURI, !envelope.board.cid.isEmpty else {
            throw Abort(.badGateway, reason: "The feedback board returned an unexpected record")
        }
        return envelope.board
    }

    private func blob(for asset: CoverAsset, account: LinkedAccount, req: Request) async throws -> ATProtoBlobRef {
        if let blobJSON = asset.blobJSON,
           let data = blobJSON.data(using: .utf8),
           let blob = try? JSONDecoder().decode(ATProtoBlobRef.self, from: data) {
            return blob
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: asset.filePath))
        let blob = try await xrpc.uploadBlob(
            account: account,
            tokenEncryption: req.application.tokenEncryption,
            database: req.db,
            data: data,
            mimeType: asset.mimeType,
            client: req.client
        )
        asset.blobJSON = String(decoding: try JSONEncoder().encode(blob), as: UTF8.self)
        try await asset.save(on: req.db)
        return blob
    }
}
