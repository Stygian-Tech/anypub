# ATProto transport

This package has no external dependencies. It implements the Swift backend's
public-client OAuth profile, PKCE, ES256 DPoP, CMS scopes, encryption envelopes,
XRPC, blob uploads, DAG-CBOR record CIDs, and timestamp record keys.

Construct with `New(Config{PublicBaseURL: baseURL, TokenEncryptionKey: secret})`.
`ClientID()`, `CallbackURL()`, and `ClientMetadata(redirectURI)` expose the existing
`/oauth/client-metadata.json` and `/api/auth/atproto/callback` conventions. The
parent HTTP server publishes the metadata document.

`StartOAuth`'s `redirectURI` is the **OAuth callback URI**, not the destination after
login. Empty uses `CallbackURL()`. Store the returned `OAuthStart` server-side;
its JSON includes the verifier and DPoP private key. Encrypt those fields at rest,
bind the state to the browser session, validate callback state, and consume it once
before `FinishOAuth`. The package checks expiration, issuer, token subject,
DPoP token type, and atproto scope. It does not own browser state or persistence.

`Session` contains plaintext access/refresh tokens and Swift-compatible private
key JSON. Call `Client.Encrypt` / `Client.Decrypt` for persistence, or the pure
`Encrypt(plaintext, secret)` / `Decrypt(ciphertext, secret)` functions. Encryption
writes Swift's `aesgcm:<base64 nonce+ciphertext+tag>` format, reads that format and
`aesgcm:v1:<base64>`, and preserves `plain:<base64>` compatibility. As in Swift,
missing/invalid base64 encryption secrets use plain encoding; valid secrets use
the first 32 decoded bytes. DPoP key JSON uses `rawRepresentation` with a standard
base64 32-byte P-256 scalar.

`XRPC` supports GET/POST and updates `*Session` after nonce challenges and token
refreshes. Persist the session **even if XRPC returns an error**, since a token
may have rotated before the operation failed. Serialize operations/refreshes
per linked session in the parent to prevent refresh-token rotation races. It
refreshes expired tokens proactively and retries once after HTTP 401. Nonce
retries are bounded; non-authentication PDS failures are not retried.

Public GETs work with `Session{PDSURL: ...}`. For raw blob downloads, pass a
`*[]byte` output; other outputs are JSON-decoded. `UploadBlob` returns the blob
reference itself, suitable for a record's image/blob field, rather than the
outer `{ "blob": ... }` envelope. `*Error` exposes HTTP status, protocol code,
and message (including InvalidSwap / RecordNotFound).

Discovery and resource requests require HTTPS and reject HTTP redirects. Unlike
Swift, handle lookup also checks the DID document's `alsoKnownAs` binding; direct
`did:web` input is supported. DPoP `htu` excludes the URL query and fragment per
RFC 9449. Authorization-server nonces only seed PDS requests on the same origin.
A replaceable `HTTPClient` permits controlled transport/testing; configure it
before concurrent use. Parent deployment networking owns outbound IP policy.
