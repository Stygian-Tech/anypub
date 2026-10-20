package atproto

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func mockClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	s := httptest.NewTLSServer(handler)
	t.Cleanup(s.Close)
	target, _ := url.Parse(s.URL)
	c := New(Config{PublicBaseURL: "https://anypub.example"})
	c.HTTPClient = &http.Client{Timeout: 5 * time.Second, Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		copy := r.Clone(r.Context())
		u := *r.URL
		u.Host = target.Host
		copy.URL = &u
		copy.Host = r.URL.Host
		return s.Client().Transport.RoundTrip(copy)
	})}
	return c
}
func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
func TestOAuthMockFlow(t *testing.T) {
	var mu sync.Mutex
	var verifier, privateKey, state string
	parAttempts, tokenAttempts, refreshes, xrpcAttempts := 0, 0, 0, 0
	c := mockClient(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.Host + r.URL.Path {
		case "alice.example/.well-known/atproto-did":
			fmt.Fprint(w, "did:plc:alice\n")
		case "plc.directory/did:plc:alice":
			writeJSON(w, map[string]any{"id": "did:plc:alice", "alsoKnownAs": []string{"at://alice.example"}, "service": []any{map[string]any{"id": "#atproto_pds", "type": "AtprotoPersonalDataServer", "serviceEndpoint": "https://pds.example"}}})
		case "pds.example/.well-known/oauth-protected-resource":
			writeJSON(w, map[string]any{"authorization_servers": []string{"https://auth.example"}})
		case "auth.example/.well-known/oauth-authorization-server":
			writeJSON(w, map[string]any{"issuer": "https://auth.example", "authorization_endpoint": "https://auth.example/authorize", "token_endpoint": "https://auth.example/token", "pushed_authorization_request_endpoint": "https://auth.example/par", "scopes_supported": []string{"atproto"}, "dpop_signing_alg_values_supported": []string{"ES256"}, "client_id_metadata_document_supported": true})
		case "auth.example/par":
			parAttempts++
			_, p := decodeJWT(t, r.Header.Get("DPoP"))
			w.Header().Set("DPoP-Nonce", "auth-nonce")
			if parAttempts == 1 {
				w.WriteHeader(400)
				writeJSON(w, map[string]string{"error": "use_dpop_nonce"})
				return
			}
			if p["nonce"] != "auth-nonce" {
				t.Error("missing PAR nonce")
			}
			_ = r.ParseForm()
			if r.Form.Get("scope") != CMSScopes || r.Form.Get("redirect_uri") != "https://anypub.example/callback" || r.Form.Get("code_challenge_method") != "S256" {
				t.Error("incorrect PAR fields", r.Form)
			}
			state = r.Form.Get("state")
			verifier = r.Form.Get("code_challenge")
			writeJSON(w, map[string]any{"request_uri": "urn:example:request", "expires_in": 90})
		case "auth.example/token":
			tokenAttempts++
			_, p := decodeJWT(t, r.Header.Get("DPoP"))
			if p["ath"] != nil {
				t.Error("token endpoint proof has ath")
			}
			w.Header().Set("DPoP-Nonce", "auth-next")
			_ = r.ParseForm()
			if r.Form.Get("grant_type") == "refresh_token" {
				refreshes++
				if r.Form.Get("refresh_token") != "refresh-1" {
					t.Error("incorrect refresh token")
				}
				writeJSON(w, map[string]any{"access_token": "access-2", "token_type": "DPoP", "scope": CMSScopes, "sub": "did:plc:alice", "expires_in": 120})
				return
			}
			if tokenAttempts == 1 {
				w.WriteHeader(400)
				writeJSON(w, map[string]string{"error": "use_dpop_nonce"})
				return
			}
			if p["nonce"] != "auth-next" || PKCEChallenge(r.Form.Get("code_verifier")) != verifier || r.Form.Get("code") != "code" {
				t.Error("invalid code exchange")
			}
			writeJSON(w, map[string]any{"access_token": "access-1", "refresh_token": "refresh-1", "token_type": "DPoP", "scope": CMSScopes, "sub": "did:plc:alice", "expires_in": 60})
		case "pds.example/xrpc/com.atproto.repo.getRecord":
			xrpcAttempts++
			_, p := decodeJWT(t, r.Header.Get("DPoP"))
			if p["htu"] != "https://pds.example/xrpc/com.atproto.repo.getRecord" {
				t.Error("proof htu must exclude query")
			}
			w.Header().Set("DPoP-Nonce", "pds-nonce")
			if xrpcAttempts == 1 {
				if p["nonce"] != nil {
					t.Error("authorization-server nonce leaked to PDS")
				}
				w.WriteHeader(401)
				writeJSON(w, map[string]string{"error": "use_dpop_nonce"})
				return
			}
			if p["nonce"] != "pds-nonce" {
				t.Error("missing PDS nonce")
			}
			if r.Header.Get("Authorization") == "DPoP access-1" {
				w.WriteHeader(401)
				writeJSON(w, map[string]string{"error": "ExpiredToken"})
				return
			}
			if r.Header.Get("Authorization") != "DPoP access-2" {
				t.Error("missing rotated token")
			}
			writeJSON(w, map[string]any{"uri": "at://did:plc:alice/app.test.record/self", "value": map[string]string{"hello": "world"}})
		case "pds.example/xrpc/com.atproto.repo.uploadBlob":
			w.Header().Set("DPoP-Nonce", "blob-nonce")
			body, _ := io.ReadAll(r.Body)
			if string(body) != "png bytes" || r.Header.Get("Content-Type") != "image/png" {
				t.Error("invalid blob upload")
			}
			writeJSON(w, map[string]any{"blob": map[string]any{"$type": "blob", "size": len(body), "mimeType": "image/png", "ref": map[string]string{"$link": "bafk-test"}}})
		default:
			t.Error("unexpected request", r.Host, r.URL.Path)
			http.NotFound(w, r)
		}
	})
	ctx := context.Background()
	start, err := c.StartOAuth(ctx, "alice.example", "https://anypub.example/callback")
	if err != nil {
		t.Fatal(err)
	}
	if start.State == "" || state != start.State || start.CodeChallenge != verifier {
		t.Fatal("missing persistable state")
	}
	privateKey = start.DPoPPrivateKey
	data, err := json.Marshal(start)
	if err != nil {
		t.Fatal(err)
	}
	var restored OAuthStart
	if err = json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	session, err := c.FinishOAuth(ctx, restored, "code", "https://auth.example")
	if err != nil {
		t.Fatal(err)
	}
	if session.DPoPPrivateKey != privateKey || session.DPoPNonce != "" || session.ExpiresAt.Before(time.Now()) {
		t.Fatal("incorrect session")
	}
	var out map[string]any
	if err = c.XRPC(ctx, &session, "GET", "com.atproto.repo.getRecord", url.Values{"repo": {"did:plc:alice"}}, nil, &out); err != nil {
		t.Fatal(err)
	}
	if session.AccessToken != "access-2" || session.RefreshToken != "refresh-1" || session.DPoPNonce != "pds-nonce" || out["uri"] == nil || refreshes != 1 {
		t.Fatal("refresh state lost", session, refreshes)
	}
	blob, err := c.UploadBlob(ctx, &session, []byte("png bytes"), "image/png")
	if err != nil || blob["$type"] != "blob" || session.DPoPNonce != "blob-nonce" {
		t.Fatal(blob, err)
	}
	if parAttempts != 2 || tokenAttempts != 3 || xrpcAttempts != 3 {
		t.Fatal("unexpected retries", parAttempts, tokenAttempts, xrpcAttempts)
	}
	if _, err = c.FinishOAuth(ctx, start, "code", "https://evil.example"); err == nil {
		t.Fatal("accepted wrong issuer")
	}
	start.ExpiresAt = time.Now().Add(-time.Second)
	if _, err = c.FinishOAuth(ctx, start, "code", start.Issuer); err == nil {
		t.Fatal("accepted expired state")
	}
}
func TestTokenValidation(t *testing.T) {
	base := tokenResponse{AccessToken: "access", TokenType: "DPoP", Scope: "atproto", Subject: "did:plc:a"}
	for _, mutate := range []func(*tokenResponse){func(t *tokenResponse) { t.AccessToken = "" }, func(t *tokenResponse) { t.Subject = "did:plc:evil" }, func(t *tokenResponse) { t.TokenType = "Bearer" }, func(t *tokenResponse) { t.Scope = "transition:generic" }, func(t *tokenResponse) { t.ExpiresIn = -1 }} {
		v := base
		mutate(&v)
		if validateToken(v, "did:plc:a") == nil {
			t.Fatal("accepted invalid token")
		}
	}
}
func TestNoRedirectOrInsecureEndpoints(t *testing.T) {
	calls := 0
	c := mockClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Redirect(w, r, "https://elsewhere.example/secret", 302)
	})
	var out any
	err := c.getJSON(context.Background(), "https://pds.example/redirect", &out)
	if err == nil || calls != 1 {
		t.Fatal("followed redirect", calls, err)
	}
	for _, u := range []string{"http://pds.example", "https://user:secret@pds.example", "https://pds.example/#fragment", "https://pds.example/path"} {
		if _, err := endpoint(u, true); err == nil {
			t.Fatal("accepted invalid origin", u)
		}
	}
}
func TestIdentityValidationAndFallback(t *testing.T) {
	c := mockClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.Host {
		case "alice.example":
			http.NotFound(w, r)
		case "public.api.bsky.app":
			writeJSON(w, map[string]string{"did": "did:web:identity.example:user"})
		case "identity.example":
			if r.URL.Path != "/user/did.json" {
				t.Error(r.URL.Path)
			}
			writeJSON(w, map[string]any{"id": "did:web:identity.example:user", "alsoKnownAs": []string{"at://different.example"}, "service": []any{map[string]string{"id": "#atproto_pds", "serviceEndpoint": "https://pds.example"}}})
		default:
			t.Error("unexpected host", r.Host)
		}
	})
	if _, err := c.ResolveIdentity(context.Background(), "alice.example"); err == nil || !strings.Contains(err.Error(), "handle") {
		t.Fatal("accepted unverified handle", err)
	}
	for _, did := range []string{"did:plc:../bad", "did:web:evil.example%2fpath", "did:web:host.example:.."} {
		if _, err := didDocumentURL(did); err == nil {
			t.Fatal("accepted malformed DID", did)
		}
	}
	got, err := didDocumentURL("did:web:host.example%3A8443:users:alice")
	if err != nil || got != "https://host.example:8443/users/alice/did.json" {
		t.Fatal(got, err)
	}
}

func TestXRPCBoundedNonceRetriesAndMissingNonce(t *testing.T) {
	key, err := NewDPoPKey()
	if err != nil {
		t.Fatal(err)
	}
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprint(missing), func(t *testing.T) {
			calls := 0
			c := mockClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if !missing {
					w.Header().Set("DPoP-Nonce", "again")
				}
				w.WriteHeader(401)
				writeJSON(w, map[string]string{"error": "use_dpop_nonce"})
			})
			s := Session{DID: "did:plc:a", PDSURL: "https://pds.example", AccessToken: "access", DPoPPrivateKey: key}
			err := c.XRPC(context.Background(), &s, "GET", "com.atproto.repo.getRecord", nil, nil, nil)
			want := 4
			if missing {
				want = 1
			}
			if err == nil || calls != want {
				t.Fatal("incorrect nonce retry bound", calls, err)
			}
		})
	}
}
func TestRefreshPersistsRotationBeforePDSFailure(t *testing.T) {
	key, _ := NewDPoPKey()
	calls := 0
	c := mockClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("DPoP-Nonce", "nonce")
		if r.URL.Path == "/token" {
			writeJSON(w, map[string]any{"access_token": "rotated-access", "refresh_token": "rotated-refresh", "token_type": "DPoP", "scope": "atproto", "sub": "did:plc:a"})
			return
		}
		calls++
		w.WriteHeader(400)
		writeJSON(w, map[string]string{"error": "InvalidSwap", "message": "repository changed"})
	})
	s := Session{DID: "did:plc:a", PDSURL: "https://pds.example", AccessToken: "old", RefreshToken: "old-refresh", TokenEndpoint: "https://auth.example/token", DPoPPrivateKey: key, ExpiresAt: time.Now().Add(-time.Second)}
	err := c.XRPC(context.Background(), &s, "POST", "com.atproto.repo.applyWrites", nil, map[string]any{"writes": []any{}}, nil)
	failure, ok := err.(*Error)
	if !ok || failure.Code != "InvalidSwap" || failure.StatusCode != 400 || s.AccessToken != "rotated-access" || s.RefreshToken != "rotated-refresh" || calls != 1 {
		t.Fatal("rotation lost or PDS failure retried", err, s, calls)
	}
}
func TestPublicReadAndRawBlob(t *testing.T) {
	c := mockClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("DPoP") != "" {
			t.Error("public read sent auth")
		}
		fmt.Fprint(w, "blob content")
	})
	s := Session{PDSURL: "https://pds.example"}
	var data []byte
	if err := c.XRPC(context.Background(), &s, "GET", "com.atproto.sync.getBlob", url.Values{"cid": {"test"}}, nil, &data); err != nil || string(data) != "blob content" {
		t.Fatal(string(data), err)
	}
}
