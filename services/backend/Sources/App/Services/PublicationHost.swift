import Foundation

enum PublicationHost: String, Codable, Equatable, Sendable {
    case leaflet
    case markpub
    case offprint
    case pckt
}

struct PublicationHostDetector: Sendable {
    static func detect(themeType: String?, themeURI: String? = nil, themeName: String?, publicationURL: String?) -> PublicationHost? {
        switch themeType {
        case "pub.leaflet.publication#theme": return .leaflet
        case "app.offprint.theme": return .offprint
        case "blog.pckt.theme": return .pckt
        default: break
        }

        if let host = detect(in: [themeType, themeURI, themeName]) {
            return host
        }

        return detect(in: [publicationURL]) ?? .markpub
    }

    private static func detect(in candidates: [String?]) -> PublicationHost? {
        let values = candidates.compactMap { $0?.lowercased() }

        if values.contains(where: { $0.contains("pub.leaflet") || $0.contains("leaflet") }) {
            return .leaflet
        }
        if values.contains(where: { $0.contains("at.markpub") || $0.contains("markpub") }) {
            return .markpub
        }
        if values.contains(where: { $0.contains("app.offprint") || $0.contains("offprint") }) {
            return .offprint
        }
        if values.contains(where: { $0.contains("blog.pckt") || $0.contains("app.pckt") || $0.contains("pckt") || $0.contains("pocket") }) {
            return .pckt
        }

        return nil
    }
}
