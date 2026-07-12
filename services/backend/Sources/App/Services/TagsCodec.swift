import Foundation

enum TagsCodec {
    static func encode(_ tags: [String]) throws -> String {
        let cleaned = tags
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let data = try JSONEncoder().encode(cleaned)
        return String(decoding: data, as: UTF8.self)
    }

    static func decode(_ raw: String) throws -> [String] {
        guard let data = raw.data(using: .utf8) else { return [] }
        return try JSONDecoder().decode([String].self, from: data)
    }
}
