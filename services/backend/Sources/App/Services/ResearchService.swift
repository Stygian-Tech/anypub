import Foundation
import Vapor

protocol RepositoryRecordPageListing: Sendable {
    func listRecordsPage(
        account: LinkedAccount,
        collection: String,
        cursor: String?,
        client: Client
    ) async throws -> ListRecordsResponse<JSONValue>
}

extension ATProtoXRPCClient: RepositoryRecordPageListing {}

struct RepositoryRecordPaginator: Sendable {
    private let records: any RepositoryRecordPageListing

    init(records: any RepositoryRecordPageListing = ATProtoXRPCClient()) {
        self.records = records
    }

    func listAll(
        account: LinkedAccount,
        collection: String,
        client: Client
    ) async throws -> [RepositoryRecord<JSONValue>] {
        var cursor: String?
        var seenCursors = Set<String>()
        var result: [RepositoryRecord<JSONValue>] = []

        while true {
            let page = try await records.listRecordsPage(
                account: account,
                collection: collection,
                cursor: cursor,
                client: client
            )
            result.append(contentsOf: page.records)

            guard !page.records.isEmpty, let nextCursor = page.cursor else { break }
            guard seenCursors.insert(nextCursor).inserted else {
                throw Abort(.badGateway, reason: "PDS repeated a \(collection) listing cursor")
            }
            cursor = nextCursor
        }

        return result
    }
}

protocol ResearchLoading: Sendable {
    func load(account: LinkedAccount, req: Request) async -> ResearchResponse
}

struct ResearchService: ResearchLoading, Sendable {
    private enum Collection {
        static let sembleCollection = "network.cosmik.collection"
        static let sembleCollectionLink = "network.cosmik.collectionLink"
        static let sembleCollectionLinkRemoval = "network.cosmik.collectionLinkRemoval"
        static let sembleCard = "network.cosmik.card"
        static let marginNote = "at.margin.note"
    }

    private let paginator: RepositoryRecordPaginator

    init(records: any RepositoryRecordPageListing = ATProtoXRPCClient()) {
        paginator = RepositoryRecordPaginator(records: records)
    }

    func load(account: LinkedAccount, req: Request) async -> ResearchResponse {
        async let sembleFetch = fetchSemble(account: account, req: req)
        async let marginFetch = fetchMargin(account: account, req: req)

        let semble: SembleResearchResponse
        do {
            semble = SembleResearchResponse(
                collections: try await sembleFetch,
                error: nil
            )
        } catch {
            req.logger.warning("Semble research refresh failed", metadata: [
                "accountDID": "\(account.did)",
                "error": "\(error)",
            ])
            semble = SembleResearchResponse(
                collections: [],
                error: "Semble research is temporarily unavailable."
            )
        }

        let margin: MarginResearchResponse
        do {
            margin = MarginResearchResponse(
                annotations: try await marginFetch,
                error: nil
            )
        } catch {
            req.logger.warning("Margin research refresh failed", metadata: [
                "accountDID": "\(account.did)",
                "error": "\(error)",
            ])
            margin = MarginResearchResponse(
                annotations: [],
                error: "Margin research is temporarily unavailable."
            )
        }

        return ResearchResponse(semble: semble, margin: margin)
    }

    func fetchSemble(account: LinkedAccount, req: Request) async throws -> [SembleCollectionResponse] {
        async let collectionFetch = paginator.listAll(
            account: account,
            collection: Collection.sembleCollection,
            client: req.client
        )
        async let linkFetch = paginator.listAll(
            account: account,
            collection: Collection.sembleCollectionLink,
            client: req.client
        )
        async let removalFetch = paginator.listAll(
            account: account,
            collection: Collection.sembleCollectionLinkRemoval,
            client: req.client
        )
        async let cardFetch = paginator.listAll(
            account: account,
            collection: Collection.sembleCard,
            client: req.client
        )
        let (collectionRecords, linkRecords, removalRecords, cardRecords) = try await (
            collectionFetch,
            linkFetch,
            removalFetch,
            cardFetch
        )

        let collections: [SembleCollection] = collectionRecords.compactMap { record -> SembleCollection? in
            guard let collection = SembleCollection(record: record, accountDID: account.did) else {
                logMalformed(record, source: "Semble collection", req: req)
                return nil
            }
            return collection
        }
        let cards = cardRecords.compactMap { record -> SembleCardResponse? in
            guard let card = SembleCardResponse(record: record, accountDID: account.did) else {
                logMalformed(record, source: "Semble card", req: req)
                return nil
            }
            return card
        }
        let cardsByURI = Dictionary(cards.map { ($0.uri, $0) }, uniquingKeysWith: { _, latest in latest })
        let removedLinkURIs = Set(removalRecords.compactMap { record -> String? in
            guard let removal = SembleCollectionLinkRemoval(record: record, accountDID: account.did) else {
                logMalformed(record, source: "Semble collection-link removal", req: req)
                return nil
            }
            return removal.removedLinkURI
        })

        var cardsByCollectionURI: [String: [SembleCardResponse]] = [:]
        var linkedCardURIsByCollectionURI: [String: Set<String>] = [:]
        for record in linkRecords {
            guard !removedLinkURIs.contains(record.uri) else { continue }
            guard let link = SembleCollectionLink(record: record, accountDID: account.did),
                  let card = cardsByURI[link.cardURI]
            else {
                logMalformed(record, source: "Semble collection link", req: req)
                continue
            }
            guard linkedCardURIsByCollectionURI[link.collectionURI, default: []].insert(link.cardURI).inserted else {
                continue
            }
            cardsByCollectionURI[link.collectionURI, default: []].append(card)
        }

        return collections.map { collection in
            SembleCollectionResponse(
                uri: collection.uri,
                name: collection.name,
                description: collection.description,
                accessType: collection.accessType,
                createdAt: collection.createdAt,
                updatedAt: collection.updatedAt,
                cards: (cardsByCollectionURI[collection.uri] ?? []).sorted {
                    newestFirst($0.createdAt, $1.createdAt, lhsTieBreaker: $0.uri, rhsTieBreaker: $1.uri)
                }
            )
        }.sorted {
            newestFirst(
                $0.updatedAt ?? $0.createdAt,
                $1.updatedAt ?? $1.createdAt,
                lhsTieBreaker: $0.uri,
                rhsTieBreaker: $1.uri
            )
        }
    }

    func fetchMargin(account: LinkedAccount, req: Request) async throws -> [MarginAnnotationResponse] {
        let records = try await paginator.listAll(
            account: account,
            collection: Collection.marginNote,
            client: req.client
        )
        return records.compactMap { record in
            guard let annotation = MarginAnnotationResponse(record: record, accountDID: account.did) else {
                logMalformed(record, source: "Margin annotation", req: req)
                return nil
            }
            return annotation
        }.sorted {
            newestFirst(
                $0.modifiedAt ?? $0.createdAt,
                $1.modifiedAt ?? $1.createdAt,
                lhsTieBreaker: $0.uri,
                rhsTieBreaker: $1.uri
            )
        }
    }

    private func logMalformed(_ record: RepositoryRecord<JSONValue>, source: String, req: Request) {
        req.logger.warning("Skipping malformed or unrelated \(source) record", metadata: ["uri": "\(record.uri)"])
    }
}

private func newestFirst(
    _ lhsTimestamp: String?,
    _ rhsTimestamp: String?,
    lhsTieBreaker: String,
    rhsTieBreaker: String
) -> Bool {
    let lhsDate = researchDate(lhsTimestamp)
    let rhsDate = researchDate(rhsTimestamp)
    if lhsDate != rhsDate {
        if let lhsDate, let rhsDate { return lhsDate > rhsDate }
        return lhsDate != nil
    }
    return lhsTieBreaker < rhsTieBreaker
}

private func researchDate(_ timestamp: String?) -> Date? {
    guard let timestamp else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: timestamp) { return date }
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return standard.date(from: timestamp)
}

struct ResearchResponse: Content, Equatable, Sendable {
    let semble: SembleResearchResponse
    let margin: MarginResearchResponse
}

struct SembleResearchResponse: Content, Equatable, Sendable {
    let collections: [SembleCollectionResponse]
    let error: String?
}

struct SembleCollectionResponse: Content, Equatable, Sendable {
    let uri: String
    let name: String
    let description: String?
    let accessType: String
    let createdAt: String?
    let updatedAt: String?
    let cards: [SembleCardResponse]
}

struct SembleCardResponse: Content, Equatable, Sendable {
    let uri: String
    let url: String?
    let title: String?
    let description: String?
    let siteName: String?
    let author: String?
    let note: String?
    let createdAt: String?

    init?(
        record: RepositoryRecord<JSONValue>,
        accountDID: String
    ) {
        guard record.belongs(to: accountDID, collection: "network.cosmik.card"),
              let value = record.value.objectValue,
              value.hasType("network.cosmik.card"),
              let cardType = value.nonEmptyString("type"),
              let content = value["content"]?.objectValue
        else { return nil }

        let metadata = content["metadata"]?.objectValue
        switch cardType {
        case "URL":
            guard content.hasType("network.cosmik.card#urlContent"),
                  let contentURL = content.nonEmptyString("url")
            else { return nil }
            url = contentURL
            title = metadata?.nonEmptyString("title")
            description = metadata?.nonEmptyString("description")
            siteName = metadata?.nonEmptyString("siteName")
            author = metadata?.nonEmptyString("author")
            note = nil
        case "NOTE":
            guard content.hasType("network.cosmik.card#noteContent"),
                  let text = content.nonEmptyString("text")
            else { return nil }
            url = value.nonEmptyString("url")
            title = nil
            description = nil
            siteName = nil
            author = nil
            note = text
        default:
            return nil
        }

        uri = record.uri
        createdAt = value.nonEmptyString("createdAt")
    }
}

struct MarginResearchResponse: Content, Equatable, Sendable {
    let annotations: [MarginAnnotationResponse]
    let error: String?
}

struct MarginAnnotationResponse: Content, Equatable, Sendable {
    let uri: String
    let motivation: String
    let source: String
    let title: String?
    let body: String?
    let quote: String?
    let tags: [String]
    let color: String?
    let createdAt: String
    let modifiedAt: String?

    init?(record: RepositoryRecord<JSONValue>, accountDID: String) {
        guard record.belongs(to: accountDID, collection: "at.margin.note"),
              let value = record.value.objectValue,
              value.hasType("at.margin.note"),
              let motivation = value.nonEmptyString("motivation"),
              let target = value["target"]?.objectValue,
              let source = target.nonEmptyString("source"),
              let createdAt = value.nonEmptyString("createdAt")
        else { return nil }

        uri = record.uri
        self.motivation = motivation
        self.source = source
        title = target.nonEmptyString("title")
        body = value["body"]?.objectValue?.nonEmptyString("value")
        quote = Self.exactQuote(in: target["selector"])
        tags = value["tags"]?.arrayValue?.compactMap(\.stringValue) ?? []
        color = value.nonEmptyString("color")
        self.createdAt = createdAt
        modifiedAt = value.nonEmptyString("modifiedAt")
    }

    private static func exactQuote(in selector: JSONValue?) -> String? {
        if let selectors = selector?.arrayValue {
            return selectors.lazy.compactMap(exactQuote).first
        }
        guard let selector = selector?.objectValue else { return nil }
        if let exact = selector.nonEmptyString("exact") { return exact }
        return exactQuote(in: selector["refinedBy"])
    }
}

private struct SembleCollection: Sendable {
    let uri: String
    let name: String
    let description: String?
    let accessType: String
    let createdAt: String?
    let updatedAt: String?

    init?(record: RepositoryRecord<JSONValue>, accountDID: String) {
        guard record.belongs(to: accountDID, collection: "network.cosmik.collection"),
              let value = record.value.objectValue,
              value.hasType("network.cosmik.collection"),
              let name = value.nonEmptyString("name"),
              let accessType = value.nonEmptyString("accessType")
        else { return nil }
        uri = record.uri
        self.name = name
        description = value.nonEmptyString("description")
        self.accessType = accessType
        createdAt = value.nonEmptyString("createdAt")
        updatedAt = value.nonEmptyString("updatedAt")
    }
}

private struct SembleCollectionLink: Sendable {
    let collectionURI: String
    let cardURI: String

    init?(record: RepositoryRecord<JSONValue>, accountDID: String) {
        guard record.belongs(to: accountDID, collection: "network.cosmik.collectionLink"),
              let value = record.value.objectValue,
              value.hasType("network.cosmik.collectionLink"),
              value.nonEmptyString("addedBy") != nil,
              value.nonEmptyString("addedAt") != nil,
              let collectionURI = value.strongReferenceURI("collection"),
              let cardURI = value.strongReferenceURI("card"),
              collectionURI.belongs(to: accountDID, collection: "network.cosmik.collection"),
              cardURI.belongs(to: accountDID, collection: "network.cosmik.card")
        else { return nil }
        self.collectionURI = collectionURI
        self.cardURI = cardURI
    }
}

private struct SembleCollectionLinkRemoval: Sendable {
    let removedLinkURI: String

    init?(record: RepositoryRecord<JSONValue>, accountDID: String) {
        guard record.belongs(to: accountDID, collection: "network.cosmik.collectionLinkRemoval"),
              let value = record.value.objectValue,
              value.hasType("network.cosmik.collectionLinkRemoval"),
              value.nonEmptyString("removedAt") != nil,
              let collectionURI = value.strongReferenceURI("collection"),
              let removedLinkURI = value.strongReferenceURI("removedLink"),
              collectionURI.belongs(to: accountDID, collection: "network.cosmik.collection")
        else { return nil }
        self.removedLinkURI = removedLinkURI
    }
}

private extension RepositoryRecord where Value == JSONValue {
    func belongs(to accountDID: String, collection: String) -> Bool {
        uri.belongs(to: accountDID, collection: collection)
    }
}

private extension String {
    func belongs(to accountDID: String, collection: String) -> Bool {
        guard let reference = try? ATRecordReference(uri: self) else { return false }
        return reference.repo == accountDID && reference.collection == collection
    }
}

private extension Dictionary where Key == String, Value == JSONValue {
    func nonEmptyString(_ key: String) -> String? {
        guard let value = self[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty
        else { return nil }
        return value
    }

    func hasType(_ expected: String) -> Bool {
        self["$type"] == nil || self["$type"]?.stringValue == expected
    }

    func strongReferenceURI(_ key: String) -> String? {
        guard let reference = self[key]?.objectValue,
              let uri = reference.nonEmptyString("uri"),
              reference.nonEmptyString("cid") != nil
        else { return nil }
        return uri
    }
}

private struct ResearchLoadingKey: StorageKey {
    typealias Value = any ResearchLoading
}

extension Application {
    var research: any ResearchLoading {
        get { storage[ResearchLoadingKey.self] ?? ResearchService() }
        set { storage[ResearchLoadingKey.self] = newValue }
    }
}
