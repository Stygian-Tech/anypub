import Crypto
import Foundation

enum ATProtoRecordCIDError: Error, Equatable {
    case invalidJSON
    case unsupportedNumber
    case invalidCIDLink
    case invalidBase32
}

enum ATProtoRecordCID {
    static func jsonValue<Record: Encodable>(_ record: Record) throws -> JSONValue {
        let data = try JSONEncoder().encode(record)
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            throw ATProtoRecordCIDError.invalidJSON
        }
        return value
    }

    static func string<Record: Encodable>(for record: Record) throws -> String {
        try string(for: jsonValue(record))
    }

    static func string(for value: JSONValue) throws -> String {
        let block = try DAGCBOREncoder.encode(value)
        let digest = SHA256.hash(data: block)
        // CIDv1, dag-cbor (0x71), sha2-256 (0x12), 32-byte digest.
        let bytes = [UInt8(0x01), 0x71, 0x12, 0x20] + Array(digest)
        return "b" + Base32Lower.encode(bytes)
    }
}

private enum DAGCBOREncoder {
    static func encode(_ value: JSONValue) throws -> Data {
        var bytes: [UInt8] = []
        try append(value, to: &bytes)
        return Data(bytes)
    }

    private static func append(_ value: JSONValue, to bytes: inout [UInt8]) throws {
        switch value {
        case .object(let object):
            if object.count == 1,
               case .string(let cid)? = object["$link"] {
                let cidBytes = try Base32Lower.decodeCID(cid)
                appendUnsigned(42, major: 6, to: &bytes)
                appendUnsigned(UInt64(cidBytes.count + 1), major: 2, to: &bytes)
                bytes.append(0)
                bytes.append(contentsOf: cidBytes)
                return
            }

            let keys = object.keys.sorted { lhs, rhs in
                let lhsBytes = Array(lhs.utf8)
                let rhsBytes = Array(rhs.utf8)
                if lhsBytes.count != rhsBytes.count { return lhsBytes.count < rhsBytes.count }
                return lhsBytes.lexicographicallyPrecedes(rhsBytes)
            }
            appendUnsigned(UInt64(keys.count), major: 5, to: &bytes)
            for key in keys {
                appendText(key, to: &bytes)
                guard let child = object[key] else { continue }
                try append(child, to: &bytes)
            }
        case .array(let values):
            appendUnsigned(UInt64(values.count), major: 4, to: &bytes)
            for child in values { try append(child, to: &bytes) }
        case .string(let string):
            appendText(string, to: &bytes)
        case .integer(let integer):
            if integer >= 0 {
                appendUnsigned(UInt64(integer), major: 0, to: &bytes)
            } else {
                appendUnsigned(UInt64(bitPattern: ~Int64(integer)), major: 1, to: &bytes)
            }
        case .number:
            // The AT Protocol data model does not permit floating-point values.
            throw ATProtoRecordCIDError.unsupportedNumber
        case .bool(let bool):
            bytes.append(bool ? 0xf5 : 0xf4)
        case .null:
            bytes.append(0xf6)
        }
    }

    private static func appendText(_ string: String, to bytes: inout [UInt8]) {
        let utf8 = Array(string.utf8)
        appendUnsigned(UInt64(utf8.count), major: 3, to: &bytes)
        bytes.append(contentsOf: utf8)
    }

    private static func appendUnsigned(_ value: UInt64, major: UInt8, to bytes: inout [UInt8]) {
        let prefix = major << 5
        switch value {
        case 0..<24:
            bytes.append(prefix | UInt8(value))
        case 24...UInt64(UInt8.max):
            bytes.append(prefix | 24)
            bytes.append(UInt8(value))
        case 256...UInt64(UInt16.max):
            bytes.append(prefix | 25)
            appendBigEndian(UInt16(value), to: &bytes)
        case 65_536...UInt64(UInt32.max):
            bytes.append(prefix | 26)
            appendBigEndian(UInt32(value), to: &bytes)
        default:
            bytes.append(prefix | 27)
            appendBigEndian(value, to: &bytes)
        }
    }

    private static func appendBigEndian<T: FixedWidthInteger>(_ value: T, to bytes: inout [UInt8]) {
        let bigEndian = value.bigEndian
        withUnsafeBytes(of: bigEndian) { bytes.append(contentsOf: $0) }
    }
}

private enum Base32Lower {
    private static let alphabet = Array("abcdefghijklmnopqrstuvwxyz234567".utf8)
    private static let values = Dictionary(uniqueKeysWithValues: alphabet.enumerated().map { ($1, UInt8($0)) })

    static func encode(_ bytes: [UInt8]) -> String {
        var output: [UInt8] = []
        var buffer: UInt32 = 0
        var bitCount = 0
        for byte in bytes {
            buffer = (buffer << 8) | UInt32(byte)
            bitCount += 8
            while bitCount >= 5 {
                bitCount -= 5
                output.append(alphabet[Int((buffer >> UInt32(bitCount)) & 31)])
            }
        }
        if bitCount > 0 {
            output.append(alphabet[Int((buffer << UInt32(5 - bitCount)) & 31)])
        }
        return String(decoding: output, as: UTF8.self)
    }

    static func decodeCID(_ value: String) throws -> [UInt8] {
        guard value.first == "b" else { throw ATProtoRecordCIDError.invalidCIDLink }
        let decoded = try decode(String(value.dropFirst()))
        guard decoded.count >= 4, decoded[0] == 1 else {
            throw ATProtoRecordCIDError.invalidCIDLink
        }
        return decoded
    }

    private static func decode(_ value: String) throws -> [UInt8] {
        var output: [UInt8] = []
        var buffer: UInt32 = 0
        var bitCount = 0
        for byte in value.lowercased().utf8 {
            guard let decoded = values[byte] else { throw ATProtoRecordCIDError.invalidBase32 }
            buffer = (buffer << 5) | UInt32(decoded)
            bitCount += 5
            if bitCount >= 8 {
                bitCount -= 8
                output.append(UInt8((buffer >> UInt32(bitCount)) & 0xff))
            }
        }
        return output
    }
}

struct ATProtoTIDGenerator: Sendable {
    private static let alphabet = Array("234567abcdefghijklmnopqrstuvwxyz")

    func generate(now: Date = Date(), clockID: UInt16 = UInt16.random(in: 0...1023)) -> String {
        let micros = UInt64(max(0, now.timeIntervalSince1970 * 1_000_000))
        var value = (micros << 10) | UInt64(clockID & 1023)
        var characters = Array(repeating: Character("2"), count: 13)
        for index in stride(from: 12, through: 0, by: -1) {
            characters[index] = Self.alphabet[Int(value & 31)]
            value >>= 5
        }
        return String(characters)
    }
}
