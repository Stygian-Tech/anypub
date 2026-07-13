import Fluent
import Foundation

struct SeedDevelopmentDrafts: AsyncMigration {
    func prepare(on database: Database) async throws {
        guard try await Draft.query(on: database).count() == 0 else { return }

        let now = Date()
        let standardNotes = "at://did:plc:writer/site.standard.publication/3lxyz"
        let fieldGuide = "at://did:plc:writer/site.standard.publication/3labc"
        let seeds: [(String, String, String, String, [String], String, DraftStatus, TimeInterval)] = [
            (standardNotes, "https://standard.example.com", "Designing a calmer publishing workflow", "Notes on reducing friction between drafting, scheduling, and publication.", ["design", "workflow"], "# Designing a calmer publishing workflow\n\nA CMS should keep editorial context visible without turning every action into a modal.", .draft, -900),
            (fieldGuide, "https://field.example.com", "Host adapters and portable Markdown", "How AnyPub preserves intent across Leaflet, Offprint, and pckt.", ["compatibility", "markdown"], "# Host adapters and portable Markdown\n\nEach publication host receives blocks shaped for its own lexicon while plaintext remains portable.", .draft, -7_200),
            (standardNotes, "https://standard.example.com", "Image workflows for independent publishing", "A practical cover-image workflow with attribution and alt text.", ["images", "accessibility"], "# Image workflows for independent publishing\n\nCover assets need attribution, useful alt text, and a stable blob reference.", .draft, -86_400),
            (fieldGuide, "https://field.example.com", "Calendar-aware editorial planning", "Linking scheduled articles to shared calendar events.", ["calendar", "planning"], "# Calendar-aware editorial planning\n\nScheduled posts should appear beside the rest of an editor's commitments.", .scheduled, 86_400),
            (standardNotes, "https://standard.example.com", "Shipping the first AnyPub CMS pass", "A compact update on the CMS workflow for standard.site publications.", ["release", "cms"], "# Shipping the first AnyPub CMS pass\n\nThe first version focuses on linked accounts, local drafts, and standard.site publishing.", .scheduled, 172_800),
            (fieldGuide, "https://field.example.com", "Publication themes as deployment signals", "Deriving Leaflet, Offprint, and pckt behavior from theme lexicons.", ["lexicons", "themes"], "# Publication themes as deployment signals\n\nThe publication theme tells the editor which host adapter should translate the document.", .scheduled, 259_200),
            (standardNotes, "https://standard.example.com", "Why drafts stay off-protocol for now", "The tradeoffs behind local draft storage before permissioned data.", ["atproto", "drafts"], "# Why drafts stay off-protocol for now\n\nLocal persistence keeps unfinished writing private while permissioned data matures.", .published, -172_800),
            (fieldGuide, "https://field.example.com", "A field guide to standard.site documents", "The minimal document fields shared by standard.site publishers.", ["standard-site", "reference"], "# A field guide to standard.site documents\n\nDocuments share a site, title, publication date, path, tags, description, and plaintext.", .published, -432_000),
            (standardNotes, "https://standard.example.com", "Building a unified editorial calendar", "Combining publication dates and community calendar events.", ["calendar", "cms"], "# Building a unified editorial calendar\n\nOne calendar can show scheduled work and published history across every publication.", .published, -691_200),
        ]

        for (index, seed) in seeds.enumerated() {
            let activityDate = now.addingTimeInterval(seed.7)
            let draft = try Draft(
                accountDID: "did:plc:writer",
                publicationURI: seed.0,
                publicationURL: seed.1,
                title: seed.2,
                path: "/" + seed.2.lowercased().replacingOccurrences(of: " ", with: "-"),
                excerpt: seed.3,
                tags: seed.4,
                markdown: seed.5,
                status: seed.6,
                scheduledAt: seed.6 == .scheduled ? activityDate : nil,
                publishedAt: seed.6 == .published ? activityDate : nil,
                createdAt: now.addingTimeInterval(TimeInterval(-index * 86_400)),
                updatedAt: activityDate
            )
            if seed.6 == .published {
                draft.documentURI = "at://did:plc:writer/site.standard.document/seed-\(index)"
                draft.documentCID = "seed-cid-\(index)"
            }
            try await draft.create(on: database)
        }
    }

    func revert(on database: Database) async throws {
        try await Draft.query(on: database)
            .filter(\.$accountDID, .equal, "did:plc:writer")
            .delete()
    }
}
