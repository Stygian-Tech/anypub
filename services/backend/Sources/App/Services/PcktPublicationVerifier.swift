import Foundation
import Vapor

struct VerifiedPcktPublication: Equatable, Sendable {
    let uri: String
    let standardPublicationCID: String
    let publicationURL: String
}

struct PcktPublicationVerifier: Sendable {
    private let xrpc = ATProtoXRPCClient()

    func verify(
        standardPublicationURI: String,
        account: LinkedAccount,
        client: Client
    ) async throws -> VerifiedPcktPublication {
        let standardReference = try ATRecordReference(uri: standardPublicationURI)
        guard standardReference.repo == account.did,
              standardReference.collection == "site.standard.publication"
        else {
            throw Abort(.unprocessableEntity, reason: "The selected publication is not a standard.site publication owned by this account")
        }

        guard let standardRecord = try await xrpc.getRecord(
            account: account,
            collection: standardReference.collection,
            rkey: standardReference.rkey,
            client: client
        ), let standardCID = standardRecord.cid else {
            throw Abort(.unprocessableEntity, reason: "The selected standard.site publication record no longer exists")
        }
        guard standardRecord.uri == standardPublicationURI else {
            throw Abort(.unprocessableEntity, reason: "The PDS returned a different standard.site publication than the one selected")
        }
        guard let standardValue = standardRecord.value.objectValue,
              standardValue["$type"]?.stringValue == "site.standard.publication",
              let publicationURL = standardValue["url"]?.stringValue,
              let parsedURL = URL(string: publicationURL),
              parsedURL.scheme?.lowercased() == "https",
              parsedURL.host != nil
        else {
            throw Abort(.unprocessableEntity, reason: "The selected standard.site publication must declare a valid HTTPS URL")
        }

        let pcktURI = "at://\(account.did)/blog.pckt.publication/\(standardReference.rkey)"
        guard let pcktRecord = try await xrpc.getRecord(
            account: account,
            collection: "blog.pckt.publication",
            rkey: standardReference.rkey,
            client: client
        ) else {
            throw Abort(.unprocessableEntity, reason: "The selected standard.site publication has no matching pckt publication")
        }
        guard pcktRecord.uri == pcktURI,
              let pcktValue = pcktRecord.value.objectValue,
              pcktValue["$type"]?.stringValue == "blog.pckt.publication",
              let publicationReference = pcktValue["publication"]?.objectValue,
              publicationReference["uri"]?.stringValue == standardPublicationURI,
              publicationReference["cid"]?.stringValue == standardCID
        else {
            throw Abort(
                .unprocessableEntity,
                reason: "The pckt publication does not strongly reference the current standard.site publication"
            )
        }

        let verificationURL = publicationURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/.well-known/site.standard.publication"
        let verificationResponse = try await client.get(URI(string: verificationURL)).get()
        guard (200..<300).contains(verificationResponse.status.code),
              let body = verificationResponse.body,
              body.getString(at: body.readerIndex, length: body.readableBytes)?
                .trimmingCharacters(in: .whitespacesAndNewlines) == standardPublicationURI
        else {
            throw Abort(
                .unprocessableEntity,
                reason: "The publication URL does not verify the selected standard.site publication"
            )
        }

        return VerifiedPcktPublication(
            uri: pcktURI,
            standardPublicationCID: standardCID,
            publicationURL: publicationURL
        )
    }
}
