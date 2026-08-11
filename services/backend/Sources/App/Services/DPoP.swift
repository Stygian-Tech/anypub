@preconcurrency import Crypto
import Foundation

struct DPoPKey: @unchecked Sendable {
    private let privateKey: P256.Signing.PrivateKey

    init() {
        privateKey = P256.Signing.PrivateKey()
    }

    init(json: String) throws {
        let stored = try JSONDecoder().decode(StoredDPoPKey.self, from: Data(json.utf8))
        guard let raw = Data(base64Encoded: stored.rawRepresentation) else {
            throw DPoPError.invalidKey
        }
        privateKey = try P256.Signing.PrivateKey(rawRepresentation: raw)
    }

    func exportJSON() throws -> String {
        let data = try JSONEncoder().encode(StoredDPoPKey(rawRepresentation: privateKey.rawRepresentation.base64EncodedString()))
        return String(decoding: data, as: UTF8.self)
    }

    func proof(httpMethod: String, url: String, accessToken: String? = nil, nonce: String? = nil) throws -> String {
        var payload: [String: JSONValue] = [
            "jti": .string(UUID().uuidString),
            "htm": .string(httpMethod.uppercased()),
            "htu": .string(url),
            "iat": .integer(Int(Date().timeIntervalSince1970)),
        ]
        if let nonce { payload["nonce"] = .string(nonce) }
        if let accessToken {
            payload["ath"] = .string(base64URLEncode(Data(SHA256.hash(data: Data(accessToken.utf8)))))
        }
        let header: [String: JSONValue] = [
            "typ": .string("dpop+jwt"),
            "alg": .string("ES256"),
            "jwk": .object(publicJWK()),
        ]
        return try signJWT(header: header, payload: payload)
    }

    private func signJWT(header: [String: JSONValue], payload: [String: JSONValue]) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let encodedHeader = base64URLEncode(try encoder.encode(header))
        let encodedPayload = base64URLEncode(try encoder.encode(payload))
        let signingInput = "\(encodedHeader).\(encodedPayload)"
        let signature = try privateKey.signature(for: Data(signingInput.utf8))
        return "\(signingInput).\(base64URLEncode(signature.rawRepresentation))"
    }

    private func publicJWK() -> [String: JSONValue] {
        let representation = privateKey.publicKey.x963Representation
        return [
            "kty": .string("EC"),
            "crv": .string("P-256"),
            "x": .string(base64URLEncode(Data(representation.dropFirst().prefix(32)))),
            "y": .string(base64URLEncode(Data(representation.dropFirst(33).prefix(32)))),
        ]
    }
}

enum DPoPError: Error {
    case invalidKey
}

private struct StoredDPoPKey: Codable {
    let rawRepresentation: String
}

func base64URLEncode(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func formEncoded(_ values: [String: String]) -> String {
    values.sorted(by: { $0.key < $1.key }).map { key, value in
        "\(formComponent(key))=\(formComponent(value))"
    }.joined(separator: "&")
}

private func formComponent(_ value: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}
