import Foundation
import NIOCore
import Vapor

struct UnsplashPhoto: Content, Sendable {
    struct User: Content, Sendable {
        let name: String
        let username: String
    }

    struct URLs: Content, Sendable {
        let raw: String
        let regular: String
        let small: String
        let thumb: String
    }

    struct Links: Content, Sendable {
        let download_location: String
        let html: String
    }

    let id: String
    let alt_description: String?
    let description: String?
    let width: Int
    let height: Int
    let blur_hash: String?
    let urls: URLs
    let links: Links
    let user: User
}

struct UnsplashSearchResponse: Content, Sendable {
    let total: Int
    let total_pages: Int
    let results: [UnsplashPhoto]
}

struct UnsplashAttribution: Codable, Sendable {
    let photoID: String
    let photographerName: String
    let photographerUsername: String
    let photographerURL: String
    let unsplashURL: String
    let downloadLocation: String
}

struct UnsplashService: Sendable {
    func search(query: String, page: Int, req: Request) async throws -> UnsplashSearchResponse {
        guard let key = req.application.anypubConfig.unsplashAccessKey else {
            throw Abort(.serviceUnavailable, reason: "Unsplash is not configured")
        }
        var components = URLComponents(string: "https://api.unsplash.com/search/photos")!
        components.queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "page", value: String(max(page, 1))),
            URLQueryItem(name: "per_page", value: "18"),
            URLQueryItem(name: "content_filter", value: "high"),
        ]
        let response = try await req.client.get(URI(string: components.url!.absoluteString)) { out in
            out.headers.add(name: "Authorization", value: "Client-ID \(key)")
            out.headers.add(name: "Accept-Version", value: "v1")
        }.get()
        guard response.status == .ok else {
            throw Abort(.badGateway, reason: "Unsplash search failed")
        }
        return try response.content.decode(UnsplashSearchResponse.self)
    }

    func select(input: UnsplashSelectRequest, req: Request) async throws -> CoverAsset {
        guard let key = req.application.anypubConfig.unsplashAccessKey else {
            throw Abort(.serviceUnavailable, reason: "Unsplash is not configured")
        }

        _ = try await req.client.get(URI(string: input.downloadLocation)) { out in
            out.headers.add(name: "Authorization", value: "Client-ID \(key)")
            out.headers.add(name: "Accept-Version", value: "v1")
        }.get()

        let imageResponse = try await req.client.get(URI(string: input.imageURL)).get()
        guard imageResponse.status == .ok, let body = imageResponse.body else {
            throw Abort(.badGateway, reason: "Unable to download Unsplash image")
        }

        let storage = AssetStorage()
        let stored = try storage.store(
            buffer: body,
            filename: "\(input.photoID).jpg",
            accountDID: input.accountDID,
            req: req
        )
        let attribution = UnsplashAttribution(
            photoID: input.photoID,
            photographerName: input.photographerName,
            photographerUsername: input.photographerUsername,
            photographerURL: input.photographerURL,
            unsplashURL: input.unsplashURL,
            downloadLocation: input.downloadLocation
        )
        let asset = CoverAsset(
            accountDID: input.accountDID,
            source: .unsplash,
            filePath: stored.filePath,
            mimeType: "image/jpeg",
            byteSize: stored.byteSize,
            altText: input.altText,
            attributionJSON: String(decoding: try JSONEncoder().encode(attribution), as: UTF8.self)
        )
        try await asset.save(on: req.db)
        return asset
    }
}

struct UnsplashSelectRequest: Content, Sendable {
    let accountDID: String
    let photoID: String
    let imageURL: String
    let downloadLocation: String
    let altText: String?
    let photographerName: String
    let photographerUsername: String
    let photographerURL: String
    let unsplashURL: String
}
