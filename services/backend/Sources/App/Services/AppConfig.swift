import Foundation

struct AppConfig: Sendable {
    let publicURL: String
    let webPublicURL: String
    let allowedOrigins: [String]
    let dataDirectory: String
    let sqlitePath: String
    let uploadsDirectory: String
    let unsplashAccessKey: String?
    let tokenEncryptionKey: String?
    let oauthClientName: String
    let oauthClientLogoURL: String?
    let oauthClientTOSURL: String?
    let oauthClientPolicyURL: String?

    static func load(environment: [String: String] = ProcessInfo.processInfo.environment) -> AppConfig {
        let publicURL = environment["APP_PUBLIC_URL"]?.nilIfBlank ?? "http://localhost:8080"
        let webPublicURL = environment["WEB_PUBLIC_URL"]?.nilIfBlank ?? "http://localhost:3000"
        let allowedOrigins = (environment["ALLOWED_ORIGINS"]?.nilIfBlank ?? webPublicURL)
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let dataDirectory = environment["ANYPUB_DATA_DIR"]?.nilIfBlank ?? "data"
        let uploadsDirectory = environment["UPLOADS_DIR"]?.nilIfBlank ?? "\(dataDirectory)/uploads"
        let sqlitePath = environment["SQLITE_PATH"]?.nilIfBlank ?? "\(dataDirectory)/anypub.sqlite"

        return AppConfig(
            publicURL: publicURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
            webPublicURL: webPublicURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
            allowedOrigins: allowedOrigins.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "/")) },
            dataDirectory: dataDirectory,
            sqlitePath: sqlitePath,
            uploadsDirectory: uploadsDirectory,
            unsplashAccessKey: environment["UNSPLASH_ACCESS_KEY"]?.nilIfBlank,
            tokenEncryptionKey: environment["TOKEN_ENCRYPTION_KEY"]?.nilIfBlank,
            oauthClientName: environment["OAUTH_CLIENT_NAME"]?.nilIfBlank ?? "AnyPub",
            oauthClientLogoURL: environment["OAUTH_CLIENT_LOGO_URL"]?.nilIfBlank,
            oauthClientTOSURL: environment["OAUTH_CLIENT_TOS_URL"]?.nilIfBlank,
            oauthClientPolicyURL: environment["OAUTH_CLIENT_POLICY_URL"]?.nilIfBlank
        )
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
