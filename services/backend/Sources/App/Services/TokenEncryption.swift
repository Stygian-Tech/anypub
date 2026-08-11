@preconcurrency import Crypto
import Foundation

enum TokenEncryptionError: Error {
    case invalidCiphertext
}

struct TokenEncryption: Sendable {
    private let key: SymmetricKey?

    var isEnabled: Bool { key != nil }

    init(secret: String?) {
        guard let secret, let data = Data(base64Encoded: secret), data.count >= 32 else {
            self.key = nil
            return
        }
        self.key = SymmetricKey(data: data.prefix(32))
    }

    func seal(_ plaintext: String) throws -> String {
        guard let key else {
            return "plain:\(Data(plaintext.utf8).base64EncodedString())"
        }
        let box = try AES.GCM.seal(Data(plaintext.utf8), using: key)
        guard let combined = box.combined else { throw TokenEncryptionError.invalidCiphertext }
        return "aesgcm:\(combined.base64EncodedString())"
    }

    func open(_ ciphertext: String) throws -> String {
        if ciphertext.hasPrefix("plain:") {
            let encoded = String(ciphertext.dropFirst("plain:".count))
            guard let data = Data(base64Encoded: encoded) else { throw TokenEncryptionError.invalidCiphertext }
            return String(decoding: data, as: UTF8.self)
        }

        guard ciphertext.hasPrefix("aesgcm:"), let key else {
            throw TokenEncryptionError.invalidCiphertext
        }
        let encoded = String(ciphertext.dropFirst("aesgcm:".count))
        guard let data = Data(base64Encoded: encoded) else { throw TokenEncryptionError.invalidCiphertext }
        let box = try AES.GCM.SealedBox(combined: data)
        let opened = try AES.GCM.open(box, using: key)
        return String(decoding: opened, as: UTF8.self)
    }
}
