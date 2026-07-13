import Vapor

struct DraftController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let drafts = routes.grouped("drafts")
        drafts.get(use: list)
        drafts.post(use: create)
        drafts.get(":id", use: get)
        drafts.put(":id", use: update)
        drafts.patch(":id", "publication", use: changePublication)
        drafts.post(":id", "schedule", use: schedule)
        drafts.post(":id", "publish", use: publish)
        drafts.post(":id", "revert", use: revertToDraft)
        drafts.delete(":id", use: delete)
    }

    func list(req: Request) async throws -> [DraftResponse] {
        var query = Draft.query(on: req.db)
        if let accountDID = try? req.query.get(String.self, at: "accountDID") {
            query = query.filter(\.$accountDID, .equal, accountDID)
        }
        if let publicationURI = try? req.query.get(String.self, at: "publicationURI") {
            query = query.filter(\.$publicationURI, .equal, publicationURI)
        }
        return try await query.sort(\.$updatedAt, .descending).all().map(DraftResponse.init(draft:))
    }

    func create(req: Request) async throws -> DraftResponse {
        let input = try req.content.decode(UpsertDraftRequest.self)
        let draft = try Draft(
            accountDID: input.accountDID,
            publicationURI: input.publicationURI,
            publicationURL: input.publicationURL,
            title: input.title,
            path: input.path,
            excerpt: input.excerpt,
            tags: input.tags,
            markdown: input.markdown,
            blockDocumentJSON: input.blockDocumentJSON,
            blockSchemaVersion: input.blockSchemaVersion ?? 1,
            blockRevision: input.blockRevision ?? 0,
            coverAssetID: input.coverAssetID
        )
        try await draft.save(on: req.db)
        return DraftResponse(draft: draft)
    }

    func get(req: Request) async throws -> DraftResponse {
        DraftResponse(draft: try await findDraft(req: req))
    }

    func update(req: Request) async throws -> DraftResponse {
        let draft = try await findDraft(req: req)
        let input = try req.content.decode(UpsertDraftRequest.self)
        draft.accountDID = input.accountDID
        draft.publicationURI = input.publicationURI
        draft.publicationURL = input.publicationURL
        draft.title = input.title
        draft.path = input.path
        draft.excerpt = input.excerpt
        draft.tagsJSON = try TagsCodec.encode(input.tags)
        draft.markdown = input.markdown
        draft.plaintext = MarkdownPlaintext.render(input.markdown)
        draft.blockDocumentJSON = input.blockDocumentJSON
        draft.blockSchemaVersion = input.blockSchemaVersion ?? draft.blockSchemaVersion ?? 1
        draft.blockRevision = input.blockRevision ?? draft.blockRevision ?? 0
        draft.coverAssetID = input.coverAssetID
        draft.updatedAt = Date()
        try await draft.save(on: req.db)
        return DraftResponse(draft: draft)
    }

    func schedule(req: Request) async throws -> DraftResponse {
        let draft = try await findDraft(req: req)
        let input = try req.content.decode(ScheduleDraftRequest.self)
        draft.scheduledAt = input.scheduledAt
        draft.typedStatus = .scheduled
        draft.updatedAt = Date()
        try await draft.save(on: req.db)

        if let account = try await LinkedAccount.query(on: req.db).filter(\.$did, .equal, draft.accountDID).first() {
            _ = try? await PublisherService().upsertCalendarEvent(for: draft, account: account, articleURI: draft.documentURI, req: req)
        }

        return DraftResponse(draft: draft)
    }

    func publish(req: Request) async throws -> PublishResult {
        try await PublisherService().publish(draft: try await findDraft(req: req), req: req)
    }

    func changePublication(req: Request) async throws -> DraftResponse {
        let draft = try await findDraft(req: req)
        guard draft.typedStatus == .draft || draft.typedStatus == .failed else {
            throw Abort(.conflict, reason: "Only drafts can change publication")
        }
        let input = try req.content.decode(ChangeDraftPublicationRequest.self)
        draft.publicationURI = input.publicationURI
        draft.publicationURL = input.publicationURL
        draft.updatedAt = Date()
        try await draft.save(on: req.db)
        return DraftResponse(draft: draft)
    }

    func revertToDraft(req: Request) async throws -> DraftResponse {
        let draft = try await findDraft(req: req)
        if draft.typedStatus == .published {
            try await PublisherService().deletePublishedDocument(for: draft, req: req)
            draft.publishedAt = nil
            draft.documentURI = nil
            draft.documentCID = nil
        }
        draft.scheduledAt = nil
        draft.typedStatus = .draft
        draft.updatedAt = Date()
        try await draft.save(on: req.db)
        return DraftResponse(draft: draft)
    }

    func delete(req: Request) async throws -> HTTPStatus {
        let draft = try await findDraft(req: req)
        if draft.typedStatus == .published {
            try await PublisherService().deletePublishedDocument(for: draft, req: req)
        }
        try await draft.delete(on: req.db)
        return .noContent
    }

    private func findDraft(req: Request) async throws -> Draft {
        guard let id = req.parameters.get("id", as: UUID.self),
              let draft = try await Draft.find(id, on: req.db)
        else { throw Abort(.notFound) }
        return draft
    }
}

struct UpsertDraftRequest: Content {
    let accountDID: String
    let publicationURI: String
    let publicationURL: String
    let title: String
    let path: String?
    let excerpt: String?
    let tags: [String]
    let markdown: String
    let blockDocumentJSON: String?
    let blockSchemaVersion: Int?
    let blockRevision: Int?
    let coverAssetID: UUID?

    init(
        accountDID: String,
        publicationURI: String,
        publicationURL: String,
        title: String,
        path: String?,
        excerpt: String?,
        tags: [String],
        markdown: String,
        blockDocumentJSON: String? = nil,
        blockSchemaVersion: Int? = nil,
        blockRevision: Int? = nil,
        coverAssetID: UUID?
    ) {
        self.accountDID = accountDID
        self.publicationURI = publicationURI
        self.publicationURL = publicationURL
        self.title = title
        self.path = path
        self.excerpt = excerpt
        self.tags = tags
        self.markdown = markdown
        self.blockDocumentJSON = blockDocumentJSON
        self.blockSchemaVersion = blockSchemaVersion
        self.blockRevision = blockRevision
        self.coverAssetID = coverAssetID
    }
}

struct ScheduleDraftRequest: Content {
    let scheduledAt: Date
}

struct ChangeDraftPublicationRequest: Content {
    let publicationURI: String
    let publicationURL: String
}

struct DraftResponse: Content {
    let id: UUID?
    let accountDID: String
    let publicationURI: String
    let publicationURL: String
    let title: String
    let path: String?
    let excerpt: String?
    let tags: [String]
    let markdown: String
    let plaintext: String
    let blockDocumentJSON: String?
    let blockSchemaVersion: Int
    let blockRevision: Int
    let coverAssetID: UUID?
    let status: String
    let scheduledAt: Date?
    let publishedAt: Date?
    let documentURI: String?
    let documentCID: String?
    let createdAt: Date
    let updatedAt: Date

    init(draft: Draft) {
        id = draft.id
        accountDID = draft.accountDID
        publicationURI = draft.publicationURI
        publicationURL = draft.publicationURL
        title = draft.title
        path = draft.path
        excerpt = draft.excerpt
        tags = draft.tags()
        markdown = draft.markdown
        plaintext = draft.plaintext
        blockDocumentJSON = draft.blockDocumentJSON
        blockSchemaVersion = draft.blockSchemaVersion ?? 1
        blockRevision = draft.blockRevision ?? 0
        coverAssetID = draft.coverAssetID
        status = draft.status
        scheduledAt = draft.scheduledAt
        publishedAt = draft.publishedAt
        documentURI = draft.documentURI
        documentCID = draft.documentCID
        createdAt = draft.createdAt
        updatedAt = draft.updatedAt
    }
}
