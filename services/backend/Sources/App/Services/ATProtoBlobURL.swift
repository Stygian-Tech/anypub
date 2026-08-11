import Foundation

func atprotoBlobURL(pdsURL: String, did: String, cid: String?) -> String? {
    guard let cid, !cid.isEmpty else { return nil }
    let base = pdsURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    var components = URLComponents(string: "\(base)/xrpc/com.atproto.sync.getBlob")
    components?.queryItems = [
        URLQueryItem(name: "did", value: did),
        URLQueryItem(name: "cid", value: cid),
    ]
    return components?.url?.absoluteString
}
