import Fluent
import FluentSQLiteDriver
import Vapor

public func configure(_ app: Application) async throws {
    let config = AppConfig.load()
    app.storage[AppConfigKey.self] = config
    app.storage[TokenEncryptionKey.self] = TokenEncryption(secret: config.tokenEncryptionKey)

    app.routes.defaultMaxBodySize = "8mb"
    app.middleware.use(FileMiddleware(publicDirectory: app.directory.publicDirectory))
    app.middleware.use(ErrorMiddleware.default(environment: app.environment))

    let cors = CORSMiddleware.Configuration(
        allowedOrigin: .originBased,
        allowedMethods: [.GET, .POST, .PUT, .PATCH, .DELETE, .OPTIONS],
        allowedHeaders: [.accept, .authorization, .contentType, .origin, .xRequestedWith],
        allowCredentials: true
    )
    app.middleware.use(CORSMiddleware(configuration: cors))

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
