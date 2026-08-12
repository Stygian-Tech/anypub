import Fluent

struct AddDiscoveryImages: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema(LinkedAccount.schema)
            .field("display_name", .string)
            .update()

        try await database.schema(LinkedAccount.schema)
            .field("avatar_cid", .string)
            .update()

        try await database.schema(PublicationCache.schema)
            .field("icon_cid", .string)
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema(PublicationCache.schema)
            .deleteField("icon_cid")
            .update()

        try await database.schema(LinkedAccount.schema)
            .deleteField("avatar_cid")
            .update()

        try await database.schema(LinkedAccount.schema)
            .deleteField("display_name")
            .update()
    }
}
