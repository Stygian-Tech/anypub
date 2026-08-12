import Fluent

struct AddRetainedPublishingIdentity: AsyncMigration {
    func prepare(on database: any Database) async throws {
        try await database.schema(Draft.schema)
            .field("retained_document_uri", .string)
            .update()
        try await database.schema(Draft.schema)
            .field("retained_platform_document_uri", .string)
            .update()
    }

    func revert(on database: any Database) async throws {
        try await database.schema(Draft.schema)
            .deleteField("retained_platform_document_uri")
            .update()
        try await database.schema(Draft.schema)
            .deleteField("retained_document_uri")
            .update()
    }
}
