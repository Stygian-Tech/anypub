import Vapor

func routes(_ app: Application) throws {
    let auth = AuthController()
    try app.register(collection: auth)

    let api = app.grouped("api").grouped(BrowserSessionAuthenticator())
    try api.register(collection: AccountController())
    try api.register(collection: PublicationController())
    try api.register(collection: DraftController())
    try api.register(collection: CalendarController())
    try api.register(collection: AssetController())
    try api.register(collection: UnsplashController())
    try api.register(collection: FeedbackController())

    app.get("health") { _ in
        HealthResponse(ok: true)
    }
}

struct HealthResponse: Content {
    let ok: Bool
}
