import AnyPubKit
import Vapor

typealias PublicationContentOffload = AnyPubKit.PublicationContentOffload
typealias PreparedPublicationContent = AnyPubKit.PreparedPublicationContent
typealias PublishedBodyImage = AnyPubKit.PublishedBodyImage

enum PublicationContentAdapter {
    static func prepare(
        document: CanonicalDocument,
        host: PublicationHost,
        description: String? = nil,
        images: [PublishedBodyImage] = []
    ) throws -> PreparedPublicationContent {
        do {
            return try AnyPubKit.PublicationContentAdapter.prepare(
                document: document, host: host, description: description, images: images
            )
        } catch let error as AnyPubKit.PublicationContentError {
            throw Abort(.unprocessableEntity, reason: error.reason)
        }
    }
}
