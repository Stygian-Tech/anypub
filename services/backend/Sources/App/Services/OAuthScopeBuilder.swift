import ATProtoAuthKit
import Foundation

enum OAuthScopeBuilder {
    static let siteStandardFull = "include:site.standard.authFull"
    static let communityCalendarFull = "include:community.lexicon.calendar.authFull"
    static let offprintFull = "include:app.offprint.authFull"
    static let pcktFull = "include:blog.pckt.authFull"
    static let userInputFull = "include:app.userinput.authFull"
    static let blobAll = "blob:*/*"
    static let transitionGeneric = "transition:generic"

    static func cmsScopes() -> String {
        [
            OAuthScopes.atproto,
            transitionGeneric,
            siteStandardFull,
            offprintFull,
            pcktFull,
            communityCalendarFull,
            userInputFull,
            blobAll,
        ].joined(separator: " ")
    }
}
