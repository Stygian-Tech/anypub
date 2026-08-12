import ATProtoAuthKit
import Foundation

enum OAuthScopeBuilder {
    static let siteStandardFull = "include:site.standard.authFull"
    static let communityCalendarFull = "include:community.lexicon.calendar.authFull"
    // app.offprint.authFull currently fails to resolve on some authorization
    // servers. AnyPub only writes the typed article wrapper; the standard.site
    // permission set covers the underlying document record.
    static let offprintArticleWrite = "repo:app.offprint.document.article?action=create&action=update&action=delete"
    static let pcktFull = "include:blog.pckt.authFull"
    static let userInputFull = "include:app.userinput.authFull"
    static let blobAll = "blob:*/*"
    static let transitionGeneric = "transition:generic"

    static func cmsScopes() -> String {
        [
            OAuthScopes.atproto,
            transitionGeneric,
            siteStandardFull,
            offprintArticleWrite,
            pcktFull,
            communityCalendarFull,
            userInputFull,
            blobAll,
        ].joined(separator: " ")
    }
}
