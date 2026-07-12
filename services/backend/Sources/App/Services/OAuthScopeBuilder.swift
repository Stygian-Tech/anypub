import ATProtoAuthKit
import Foundation

enum OAuthScopeBuilder {
    static let siteStandardFull = "include:site.standard.authFull"
    static let communityCalendarFull = "include:community.lexicon.calendar.authFull"
    static let transitionGeneric = "transition:generic"

    static func cmsScopes() -> String {
        [
            OAuthScopes.atproto,
            transitionGeneric,
            siteStandardFull,
            communityCalendarFull,
        ].joined(separator: " ")
    }
}
