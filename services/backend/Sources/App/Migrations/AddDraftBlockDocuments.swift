import Fluent

struct AddDraftBlockDocuments: AsyncMigration {
    func prepare(on database: any Database) async throws {
        try await database.schema(Draft.schema)
            .field("block_document_json", .string)
            .update()
        try await database.schema(Draft.schema)
            .field("block_schema_version", .int)
            .update()
        try await database.schema(Draft.schema)
            .field("block_revision", .int)
            .update()
    }

    func revert(on database: any Database) async throws {
        try await database.schema(Draft.schema)
            .deleteField("block_revision")
            .update()
        try await database.schema(Draft.schema)
            .deleteField("block_schema_version")
            .update()
        try await database.schema(Draft.schema)
            .deleteField("block_document_json")
            .update()
    }
}
