import Fluent

struct AddAssetDimensions: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema(CoverAsset.schema)
            .field("width", .int)
            .update()
        try await database.schema(CoverAsset.schema)
            .field("height", .int)
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema(CoverAsset.schema)
            .deleteField("height")
            .update()
        try await database.schema(CoverAsset.schema)
            .deleteField("width")
            .update()
    }
}
