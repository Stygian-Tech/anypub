import ATProtoAuthKit
import Foundation

enum OAuthScopeBuilder {
    static let siteStandardFull = "include:site.standard.authFull"
    static let communityCalendarFull = "include:community.lexicon.calendar.authFull"
    static let offprintFull = "include:app.offprint.authFull"
    static let pcktFull = "include:blog.pckt.authFull"
    static let transitionGeneric = "transition:generic"

    static func cmsScopes() -> String {
        [
            OAuthScopes.atproto,
            transitionGeneric,
            siteStandardFull,
            offprintFull,
            pcktFull,
            communityCalendarFull,
        ].joined(separator: " ")
    }
}
