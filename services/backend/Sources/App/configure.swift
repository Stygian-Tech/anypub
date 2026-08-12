import Fluent
import FluentSQLiteDriver
import Vapor

public func configure(_ app: Application) async throws {
    let config = AppConfig.load()
    let tokenEncryption = TokenEncryption(secret: config.tokenEncryptionKey)
    if app.environment == .production, !tokenEncryption.isEnabled {
        throw Abort(.internalServerError, reason: "TOKEN_ENCRYPTION_KEY must be valid base64 containing at least 32 bytes in production")
    }
    app.storage[AppConfigKey.self] = config
    app.storage[TokenEncryptionKey.self] = tokenEncryption

    app.routes.defaultMaxBodySize = "8mb"
    app.middleware.use(FileMiddleware(publicDirectory: app.directory.publicDirectory))

    let cors = CORSMiddleware.Configuration(
        allowedOrigin: .any(config.allowedOrigins),
        allowedMethods: [.GET, .POST, .PUT, .PATCH, .DELETE, .OPTIONS],
        allowedHeaders: [.accept, .authorization, .contentType, .origin, .xRequestedWith],
        allowCredentials: true
    )
    app.middleware.use(CORSMiddleware(configuration: cors))
    // Keep the error middleware inside CORS so failed API responses remain
    // readable by the browser client instead of being reduced to CORS errors.
    app.middleware.use(ErrorMiddleware.default(environment: app.environment))

    try FileManager.default.createDirectory(
        atPath: config.dataDirectory,
        withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(
        atPath: config.uploadsDirectory,
        withIntermediateDirectories: true
    )

    if app.environment == .testing {
        app.databases.use(.sqlite(.memory), as: .sqlite)
    } else {
        app.databases.use(.sqlite(.file(config.sqlitePath)), as: .sqlite)
    }

    app.migrations.add(CreateAnyPubTables())
    app.migrations.add(AddDraftBlockDocuments())
    app.migrations.add(AddPublishingState())
    app.migrations.add(AddDiscoveryImages())
    app.migrations.add(AddRetainedPublishingIdentity())
    app.migrations.add(AddAssetDimensions())
    app.migrations.add(AddBrowserSessions())
    if app.environment == .development || app.environment == .testing {
        app.migrations.add(SeedDevelopmentDrafts())
    }
    try await app.autoMigrate()

    app.lifecycle.use(ScheduledPublisherLifecycle())

    try routes(app)
}

private struct AppConfigKey: StorageKey {
    typealias Value = AppConfig
}

extension Application {
    var anypubConfig: AppConfig {
        storage[AppConfigKey.self] ?? .load()
    }
}

private struct TokenEncryptionKey: StorageKey {
    typealias Value = TokenEncryption
}

extension Application {
    var tokenEncryption: TokenEncryption {
        storage[TokenEncryptionKey.self] ?? TokenEncryption(secret: nil)
    }
}
