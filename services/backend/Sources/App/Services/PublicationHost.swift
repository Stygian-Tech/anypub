import Foundation

enum PublicationHost: String, Codable, Equatable, Sendable {
    case leaflet
    case offprint
    case pckt
}

struct PublicationHostDetector: Sendable {
    static func detect(themeType: String?, themeName: String?, publicationURL: String?) -> PublicationHost? {
        if let host = detect(in: [themeType, themeName]) {
            return host
        }

        return detect(in: [publicationURL])
    }

    private static func detect(in candidates: [String?]) -> PublicationHost? {
        let values = candidates.compactMap { $0?.lowercased() }

        if values.contains(where: { $0.contains("pub.leaflet") || $0.contains("leaflet") }) {
            return .leaflet
        }
        if values.contains(where: { $0.contains("pub.offprint") || $0.contains("offprint") }) {
            return .offprint
        }
        if values.contains(where: { $0.contains("app.pckt") || $0.contains("pub.pckt") || $0.contains("pckt") || $0.contains("pocket") }) {
            return .pckt
        }

        return nil
    }
}
