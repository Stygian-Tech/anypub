import Foundation
import NIOCore
import Vapor

struct StoredAsset: Sendable {
    let filePath: String
    let byteSize: Int
}

struct AssetStorage: Sendable {
    func store(buffer: ByteBuffer, filename: String, accountDID: String, req: Request) throws -> StoredAsset {
        let safeName = filename
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: " ", with: "-")
        let accountDir = "\(req.application.anypubConfig.uploadsDirectory)/\(accountDID)"
        try FileManager.default.createDirectory(atPath: accountDir, withIntermediateDirectories: true)
        let filePath = "\(accountDir)/\(UUID().uuidString)-\(safeName)"
        let data = Data(buffer.readableBytesView)
        try data.write(to: URL(fileURLWithPath: filePath), options: .atomic)
        return StoredAsset(filePath: filePath, byteSize: data.count)
    }
}
