import Vapor

struct AssetController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {
        let assets = routes.grouped("assets")
        assets.post("upload", use: upload)
        assets.get(use: list)
    }

    func list(req: Request) async throws -> [CoverAsset] {
        let accountDID = try req.query.get(String.self, at: "accountDID")
        return try await CoverAsset.query(on: req.db)
            .filter(\.$accountDID, .equal, accountDID)
            .sort(\.$createdAt, .descending)
            .all()
    }

    func upload(req: Request) async throws -> CoverAsset {
        let input = try req.content.decode(UploadCoverRequest.self)
        let stored = try AssetStorage().store(
            buffer: input.file.data,
            filename: input.file.filename,
            accountDID: input.accountDID,
            req: req
        )
        let asset = CoverAsset(
            accountDID: input.accountDID,
            source: .device,
            filePath: stored.filePath,
            mimeType: input.file.contentType?.serialize() ?? "application/octet-stream",
            byteSize: stored.byteSize,
            altText: input.altText,
            attributionJSON: nil
        )
        try await asset.save(on: req.db)
        return asset
    }
}

struct UploadCoverRequest: Content {
    let accountDID: String
    let altText: String?
    let file: File
}
