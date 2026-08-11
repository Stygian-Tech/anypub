import Fluent
import Foundation
import Vapor

protocol PublicationRecordListing: Sendable {
    func listPublicationRecordsPage(
        account: LinkedAccount,
        cursor: String?,
        tokenEncryption: TokenEncryption,
        database: Database,
        client: Client
    ) async throws -> ListRecordsResponse<JSONValue>
}

extension ATProtoXRPCClient: PublicationRecordListing {}

protocol PublicationDiscovering: Sendable {
    func sync(account: LinkedAccount, req: Request) async throws -> [PublicationCache]
}

struct PublicationDiscoveryService: PublicationDiscovering, Sendable {
    private let records: any PublicationRecordListing

    init(records: any PublicationRecordListing = ATProtoXRPCClient()) {
        self.records = records
    }

    func sync(account: LinkedAccount, req: Request) async throws -> [PublicationCache] {
        let discovered = try await fetchAll(account: account, req: req)
        return try await reconcile(
            discovered,
            accountDID: account.did,
            database: req.db,
            logger: req.logger
        )
    }

    func fetchAll(account: LinkedAccount, req: Request) async throws -> [DiscoveredPublication] {
        var cursor: String?
        var seenCursors = Set<String>()
        var discovered: [DiscoveredPublication] = []

        while true {
            let page = try await records.listPublicationRecordsPage(
                account: account,
                cursor: cursor,
                tokenEncryption: req.application.tokenEncryption,
                database: req.db,
                client: req.client
            )

            for record in page.records {
                guard let publication = DiscoveredPublication(record: record, accountDID: account.did) else {
                    req.logger.warning("Skipping malformed or unrelated publication record", metadata: ["uri": "\(record.uri)"])
                    continue
                }
                guard !publication.isBlento else { continue }
                discovered.append(publication)
            }

            guard !page.records.isEmpty, let nextCursor = page.cursor else { break }
            guard seenCursors.insert(nextCursor).inserted else {
                throw Abort(.badGateway, reason: "PDS repeated a publication listing cursor")
            }
            cursor = nextCursor
        }

        return discovered
    }

    func reconcile(
        _ publications: [DiscoveredPublication],
        accountDID: String,
        database: Database,
        logger: Logger,
        syncedAt: Date = Date()
    ) async throws -> [PublicationCache] {
        let byURI = Dictionary(publications.map { ($0.uri, $0) }, uniquingKeysWith: { _, latest in latest })

        return try await database.transaction { transaction in
            let cached = try await PublicationCache.query(on: transaction)
                .filter(\.$accountDID, .equal, accountDID)
                .all()
            let cachedByURI = Dictionary(cached.map { ($0.uri, $0) }, uniquingKeysWith: { first, _ in first })

            for publication in byURI.values {
                let host = PublicationHostDetector.detect(
                    themeType: publication.themeType,
                    themeURI: publication.themeURI,
                    themeName: publication.themeName,
                    publicationURL: publication.url
                )

                if let existing = cachedByURI[publication.uri] {
                    existing.cid = publication.cid
                    existing.name = publication.name
                    existing.url = publication.url
                    existing.publicationDescription = publication.description
                    existing.themeType = publication.themeType
                    existing.themeName = publication.themeName
                    existing.host = host?.rawValue
                    existing.syncedAt = syncedAt
                    try await existing.save(on: transaction)
                } else {
                    try await PublicationCache(
                        accountDID: accountDID,
                        uri: publication.uri,
                        cid: publication.cid,
                        name: publication.name,
                        url: publication.url,
                        publicationDescription: publication.description,
                        themeType: publication.themeType,
                        themeName: publication.themeName,
                        host: host,
                        syncedAt: syncedAt
                    ).save(on: transaction)
                }
            }

            for stale in cached where byURI[stale.uri] == nil {
                try await stale.delete(on: transaction)
            }

            let reconciled = try await PublicationCache.query(on: transaction)
                .filter(\.$accountDID, .equal, accountDID)
                .sort(\.$name)
                .all()
            logger.debug("Reconciled publication cache", metadata: [
                "accountDID": "\(accountDID)",
                "count": "\(reconciled.count)",
            ])
            return reconciled
        }
    }
}

struct DiscoveredPublication: Equatable, Sendable {
    let uri: String
    let cid: String?
    let name: String
    let url: String
    let description: String?
    let themeType: String?
    let themeURI: String?
    let themeName: String?
    let rkey: String

    var isBlento: Bool { rkey == "blento.self" }

    init?(record: RepositoryRecord<JSONValue>, accountDID: String) {
        guard let reference = try? ATRecordReference(uri: record.uri),
              reference.repo == accountDID,
              reference.collection == "site.standard.publication",
              let value = record.value.objectValue
        else { return nil }
        if let declaredType = value["$type"], declaredType.stringValue != "site.standard.publication" {
            return nil
        }
        guard let name = value["name"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !name.isEmpty,
              let url = value["url"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !url.isEmpty
        else { return nil }

        let theme = value["theme"]
        let themeObject = theme?.objectValue
        uri = record.uri
        cid = record.cid
        self.name = name
        self.url = url
        description = value["description"]?.stringValue
        themeType = themeObject?["$type"]?.stringValue
        themeURI = theme?.stringValue ?? themeObject?["uri"]?.stringValue
        themeName = themeObject?["name"]?.stringValue
        rkey = reference.rkey
    }
}

private extension JSONValue {
    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }
}

private struct PublicationDiscoveryKey: StorageKey {
    typealias Value = any PublicationDiscovering
}

extension Application {
    var publicationDiscovery: any PublicationDiscovering {
        get { storage[PublicationDiscoveryKey.self] ?? PublicationDiscoveryService() }
        set { storage[PublicationDiscoveryKey.self] = newValue }
    }
}
