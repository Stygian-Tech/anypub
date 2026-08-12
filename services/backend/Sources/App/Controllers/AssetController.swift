import Vapor

struct AssetController: RouteCollection {
    private static let maximumImageSize = 1_000_000
    private static let supportedImageTypes: Set<String> = ["image/gif", "image/jpeg", "image/png", "image/webp"]

    func boot(routes: RoutesBuilder) throws {
        let assets = routes.grouped("assets")
        assets.post("upload", use: upload)
        assets.get(":assetID", "content", use: content)
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
        let mimeType = input.file.contentType?.serialize().lowercased() ?? "application/octet-stream"
        guard Self.supportedImageTypes.contains(mimeType) else {
            throw Abort(.unsupportedMediaType, reason: "Upload a PNG, JPEG, GIF, or WebP image")
        }
        guard input.file.data.readableBytes <= Self.maximumImageSize else {
            throw Abort(.payloadTooLarge, reason: "Images must be 1 MB or smaller for publication compatibility")
        }
        guard input.width.map({ $0 > 0 }) ?? true, input.height.map({ $0 > 0 }) ?? true else {
            throw Abort(.unprocessableEntity, reason: "Image dimensions must be positive")
        }
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
            mimeType: mimeType,
            byteSize: stored.byteSize,
            altText: input.altText,
            width: input.width,
            height: input.height,
            attributionJSON: nil
        )
        try await asset.save(on: req.db)
        return asset
    }

    func content(req: Request) async throws -> Response {
        guard let assetID = req.parameters.get("assetID", as: UUID.self),
              let asset = try await CoverAsset.find(assetID, on: req.db)
        else {
            throw Abort(.notFound, reason: "Image asset not found")
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: asset.filePath))
        var headers = HTTPHeaders()
        headers.replaceOrAdd(name: .contentType, value: asset.mimeType)
        headers.replaceOrAdd(name: .cacheControl, value: "private, max-age=3600")
        return Response(status: .ok, headers: headers, body: .init(data: data))
    }
}

struct UploadCoverRequest: Content {
    let accountDID: String
    let altText: String?
    let width: Int?
    let height: Int?
    let file: File
}
