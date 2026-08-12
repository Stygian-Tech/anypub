import Fluent

struct AddBrowserSessions: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema(BrowserSession.schema)
            .id()
            .field("token_hash", .string, .required)
            .field("account_did", .string)
            .field("created_at", .datetime, .required)
            .field("updated_at", .datetime, .required)
            .field("expires_at", .datetime, .required)
            .unique(on: "token_hash")
            .create()

        try await database.schema(OAuthStateRecord.schema)
            .field("browser_session_id", .uuid)
            .update()
    }

    func revert(on database: Database) async throws {
        try await database.schema(OAuthStateRecord.schema)
            .deleteField("browser_session_id")
            .update()
        try await database.schema(BrowserSession.schema).delete()
    }
}
