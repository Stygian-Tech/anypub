import Foundation
import Vapor

protocol AccountProfileRecordLoading: Sendable {
    func getAccountProfileRecord(
        account: LinkedAccount,
        client: Client
    ) async throws -> RepositoryRecord<JSONValue>?
}

extension ATProtoXRPCClient: AccountProfileRecordLoading {}

protocol AccountProfileDiscovering: Sendable {
    func sync(account: LinkedAccount, req: Request) async throws
}

struct AccountProfileService: AccountProfileDiscovering, Sendable {
    private let records: any AccountProfileRecordLoading

    init(records: any AccountProfileRecordLoading = ATProtoXRPCClient()) {
        self.records = records
    }

    func sync(account: LinkedAccount, req: Request) async throws {
        let record = try await records.getAccountProfileRecord(account: account, client: req.client)
        let value = record?.value.objectValue
        let displayName = value?["displayName"]?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let nextDisplayName = displayName?.isEmpty == false ? displayName : nil
        let nextAvatarCID = value?["avatar"]?.blobCID
        guard account.displayName != nextDisplayName || account.avatarCID != nextAvatarCID else { return }

        account.displayName = nextDisplayName
        account.avatarCID = nextAvatarCID
        try await account.save(on: req.db)
    }
}

private struct AccountProfileDiscoveryKey: StorageKey {
    typealias Value = any AccountProfileDiscovering
}

extension Application {
    var accountProfileDiscovery: any AccountProfileDiscovering {
        get { storage[AccountProfileDiscoveryKey.self] ?? AccountProfileService() }
        set { storage[AccountProfileDiscoveryKey.self] = newValue }
    }
}
