package backend

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func appForTest(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	s, e := New(Config{PublicURL: "https://api.example", WebURL: "https://web.example", DataDir: dir, UploadsDir: filepath.Join(dir, "uploads"), SQLitePath: filepath.Join(dir, "test.sqlite"), ClientName: "AnyPub", AllowedOrigins: []string{"https://web.example"}})
	if e != nil {
		t.Fatal(e)
	}
	s.AT.HTTPClient = &http.Client{Transport: backendRoundTripper(func(r *http.Request) (*http.Response, error) {
		return wireForTest(503, Row{"error": "Unavailable"}), nil
	})}
	s.HTTP = s.AT.HTTPClient
	t.Cleanup(func() { s.Close() })
	return s
}
func saveForTest(t *testing.T, s *Server, table string, r Row) Row {
	t.Helper()
	if e := s.Store.Save(context.Background(), table, r); e != nil {
		t.Fatal(e)
	}
	return r
}
func accountForTest(t *testing.T, s *Server, did string) Row {
	t.Helper()
	key, e := atproto.NewDPoPKey()
	if e != nil {
		t.Fatal(e)
	}
	a := Row{"did": did, "linked_at": now()}
	e = s.persistSession(context.Background(), a, atproto.Session{DID: did, Handle: "writer.example", PDSURL: "https://pds.example", AccessToken: "access", RefreshToken: "refresh", DPoPPrivateKey: key, Scopes: atproto.CMSScopes, TokenEndpoint: "https://auth.example/token"})
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func cookieForTest(t *testing.T, s *Server, a Row) *http.Cookie {
	t.Helper()
	tok := token()
	saveForTest(t, s, "browser_sessions", Row{"token_hash": hash(tok), "account_did": a["did"], "created_at": now(), "updated_at": now(), "expires_at": now() + 86400})
	return &http.Cookie{Name: "anypub_session", Value: tok}
}
func requestForTest(t *testing.T, s *Server, method, path string, in any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if in != nil {
		body = bytes.NewBufferString(jsonString(in))
	}
	r := httptest.NewRequest(method, path, body)
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func resultForTest(t *testing.T, w *httptest.ResponseRecorder) Row {
	t.Helper()
	var out Row
	if e := json.Unmarshal(w.Body.Bytes(), &out); e != nil {
		t.Fatalf("decode %d %s: %v", w.Code, w.Body, e)
	}
	return out
}
func draftForTest(t *testing.T, s *Server, a Row, host string) Row {
	t.Helper()
	uri := "at://" + str(a["did"]) + "/site.standard.publication/pub"
	saveForTest(t, s, "publication_cache", Row{"account_did": a["did"], "uri": uri, "name": "Publication", "url": "https://publication.example", "host": host, "synced_at": now()})
	return saveForTest(t, s, "drafts", Row{"account_did": a["did"], "publication_uri": uri, "publication_url": "https://publication.example", "title": "Test article", "path": "/test", "tags_json": "[]", "markdown": "# Heading\n\nBody **bold**", "plaintext": "Heading\nBody bold", "status": "draft", "created_at": now(), "updated_at": now()})
}

type backendRoundTripper func(*http.Request) (*http.Response, error)

func (f backendRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func wireForTest(status int, v any) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}, "Dpop-Nonce": {"pds-nonce"}}, Body: io.NopCloser(strings.NewReader(jsonString(v)))}
}
func TestFluentMigrationIntegration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "legacy.sqlite")
	db, e := sql.Open("sqlite3", path)
	if e != nil {
		t.Fatal(e)
	}
	fixture, e := os.ReadFile("testdata/fluent_legacy.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(string(fixture)); e != nil {
		t.Fatal(e)
	}
	db.Close()
	store, e := OpenStore(path)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.Close()
	ctx := context.Background()
	rows, e := store.Rows(ctx, "drafts", "ORDER BY title")
	if e != nil || len(rows) != 9 {
		t.Fatalf("legacy drafts %d: %v", len(rows), e)
	}
	before := rows[0]
	if date(before["created_at"]).Year() != 2026 {
		t.Fatalf("Fluent timestamp decoded incorrectly: %v", before["created_at"])
	}
	var migrations int
	if e = store.DB.QueryRow("SELECT count(*) FROM _fluent_migrations").Scan(&migrations); e != nil || migrations != 8 {
		t.Fatalf("migration history changed: %d %v", migrations, e)
	}
	oldCreated := before["created_at"]
	before["title"] = "Edited by Go"
	before["updated_at"] = now()
	if e = store.Save(ctx, "drafts", before); e != nil {
		t.Fatal(e)
	}
	after, e := store.One(ctx, "drafts", "WHERE id=?", before["id"])
	if e != nil || after["created_at"] != oldCreated || after["title"] != "Edited by Go" {
		t.Fatalf("roundtrip: %#v %v", after, e)
	}
	if e = store.migrate(ctx); e != nil {
		t.Fatal(e)
	}
}
func TestPartiallyMigratedDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.sqlite")
	db, _ := sql.Open("sqlite3", path)
	_, e := db.Exec(`CREATE TABLE drafts(id UUID PRIMARY KEY,account_did TEXT NOT NULL,publication_uri TEXT NOT NULL,publication_url TEXT NOT NULL,title TEXT NOT NULL,path TEXT,excerpt TEXT,tags_json TEXT NOT NULL,markdown TEXT NOT NULL,plaintext TEXT NOT NULL,cover_asset_id UUID,status TEXT NOT NULL,scheduled_at REAL,published_at REAL,document_uri TEXT,document_cid TEXT,created_at REAL NOT NULL,updated_at REAL NOT NULL); INSERT INTO drafts(id,account_did,publication_uri,publication_url,title,tags_json,markdown,plaintext,status,created_at,updated_at) VALUES('ABC','did:plc:old','at://did:plc:old/site.standard.publication/pub','https://example.com','Old','[]','Body','Body','draft',1700000000,1700000000)`)
	db.Close()
	if e != nil {
		t.Fatal(e)
	}
	store, e := OpenStore(path)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.Close()
	r, e := store.One(context.Background(), "drafts", "WHERE id='ABC'")
	if e != nil || r["title"] != "Old" {
		t.Fatalf("lost old data: %v %v", r, e)
	}
	if draftResponse(r)["blockSchemaVersion"] != 1 {
		t.Fatal("missing legacy schema default")
	}
}
func TestOwnedBrowserAPI(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	other := accountForTest(t, s, "did:plc:other")
	cookie := cookieForTest(t, s, a)
	d := draftForTest(t, s, other, "markpub")
	for _, tc := range []struct {
		method, path string
		in           any
		want         int
	}{{"GET", "/api/drafts", nil, 401}, {"GET", "/api/assets?accountDID=did:plc:other", nil, 403}, {"GET", "/api/drafts/" + str(d["id"]), nil, 404}, {"DELETE", "/api/accounts/did:plc:other", nil, 403}, {"POST", "/api/publications/sync", Row{"accountDID": other["did"]}, 403}, {"POST", "/api/drafts", Row{"accountDID": a["did"], "publicationURI": d["publication_uri"], "publicationURL": "https://example.com", "title": "Bad", "markdown": "Hi"}, 403}} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			c := cookie
			if tc.want == 401 {
				c = nil
			}
			w := requestForTest(t, s, tc.method, tc.path, tc.in, c)
			if w.Code != tc.want {
				t.Fatalf("%d: %s", w.Code, w.Body)
			}
		})
	}
	w := requestForTest(t, s, "GET", "/api/drafts", nil, cookie)
	if w.Body.String() != "[]\n" {
		t.Fatalf("leaked another account drafts: %s", w.Body)
	}
}
func TestDraftLifecycleHTTP(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	in := Row{"accountDID": a["did"], "publicationURI": "at://did:plc:writer/site.standard.publication/pub", "publicationURL": "https://publication.example", "title": "Title", "markdown": "# Hello\n\nBody", "tags": []any{"a", "b"}}
	w := requestForTest(t, s, "POST", "/api/drafts", in, cookie)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	d := resultForTest(t, w)
	id := str(d["id"])
	if d["plaintext"] != "Hello\nBody" || d["status"] != "draft" || d["blockSchemaVersion"] != float64(1) {
		t.Fatalf("invalid response: %#v", d)
	}
	path := "/api/drafts/" + id
	in["title"] = "Updated"
	w = requestForTest(t, s, "PUT", path, in, cookie)
	if w.Code != 200 || resultForTest(t, w)["title"] != "Updated" {
		t.Fatal(w.Body.String())
	}
	w = requestForTest(t, s, "POST", path+"/schedule", Row{"scheduledAt": "2027-01-02T03:04:05Z"}, cookie)
	if w.Code != 200 || resultForTest(t, w)["status"] != "scheduled" {
		t.Fatal(w.Body.String())
	}
	w = requestForTest(t, s, "PATCH", path+"/publication", Row{"publicationURI": in["publicationURI"], "publicationURL": in["publicationURL"]}, cookie)
	if w.Code != 409 {
		t.Fatal(w.Body.String())
	}
	w = requestForTest(t, s, "GET", "/api/calendar", nil, cookie)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "2027-01-02T03:04:05Z") {
		t.Fatal(w.Body.String())
	}
	w = requestForTest(t, s, "POST", path+"/revert", Row{}, cookie)
	if w.Code != 200 || resultForTest(t, w)["scheduledAt"] != nil {
		t.Fatal(w.Body.String())
	}
	w = requestForTest(t, s, "DELETE", path, nil, cookie)
	if w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w = requestForTest(t, s, "GET", path, nil, cookie); w.Code != 404 {
		t.Fatal("deleted draft remained")
	}
}
func TestSessionExpiryUnlinkAndSecretFiltering(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	s.AT.HTTPClient = &http.Client{Transport: backendRoundTripper(func(r *http.Request) (*http.Response, error) { return wireForTest(200, Row{"records": []any{}}), nil })}
	w := requestForTest(t, s, "GET", "/api/accounts", nil, cookie)
	for _, secret := range []string{"access_token", "accessToken", "refresh", "rawRepresentation", "dpop"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatalf("secret leaked: %s", w.Body)
		}
	}
	w = requestForTest(t, s, "DELETE", "/api/accounts/did:plc:writer", nil, cookie)
	if w.Code != 204 || !strings.Contains(w.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("unlink %d %s", w.Code, w.Header())
	}
	if requestForTest(t, s, "GET", "/api/accounts", nil, cookie).Code != 401 {
		t.Fatal("unlinked session remained valid")
	}
	a2 := cookieForTest(t, s, a)
	_, _ = s.Store.DB.Exec("UPDATE browser_sessions SET expires_at=1")
	if requestForTest(t, s, "GET", "/api/drafts", nil, a2).Code != 401 {
		t.Fatal("expired session valid")
	}
	var count int
	_ = s.Store.DB.QueryRow("SELECT count(*) FROM browser_sessions").Scan(&count)
	if count != 0 {
		t.Fatal("expired session not removed")
	}
}
func TestOAuthBrowserOwnershipAndMetadata(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	sessionReq := httptest.NewRequest("GET", "/", nil)
	sessionReq.AddCookie(cookie)
	session, _ := s.session(sessionReq)
	saveForTest(t, s, "oauth_states", Row{"state": "state", "handle": "writer.example", "code_verifier": "plain:eA==", "redirect_url": "https://web.example/editor", "browser_session_id": uuid(), "created_at": now(), "expires_at": now() + 600})
	w := requestForTest(t, s, "GET", "/api/auth/atproto/callback?state=state&code=code&iss=https://auth.example", nil, cookie)
	if w.Code != 401 {
		t.Fatalf("cross-browser callback accepted %d %s", w.Code, w.Body)
	}
	_, _ = s.Store.DB.Exec("UPDATE oauth_states SET browser_session_id=?,expires_at=1", session["id"])
	w = requestForTest(t, s, "GET", "/api/auth/atproto/callback?state=state&code=code&iss=https://auth.example", nil, cookie)
	if w.Code != 400 {
		t.Fatal(w.Body.String())
	}
	w = requestForTest(t, s, "GET", "/oauth/client-metadata.json", nil, nil)
	m := resultForTest(t, w)
	if m["client_id"] != "https://api.example/oauth/client-metadata.json" || m["token_endpoint_auth_method"] != "none" {
		t.Fatal(m)
	}
	w = requestForTest(t, s, "GET", "/oauth/jwks.json", nil, nil)
	if w.Code != 200 || w.Body.String() != "{\"keys\":[]}\n" {
		t.Fatal(w.Body.String())
	}
}
func TestRedirectPolicy(t *testing.T) {
	s := appForTest(t)
	for _, tc := range []struct{ input, want string }{{"", "https://web.example/editor"}, {"https://web.example/", "https://web.example/editor"}, {"https://evil.example/editor", "https://web.example/editor"}, {"https://user@web.example/editor", "https://web.example/editor"}, {"https://web.example/editor#x", "https://web.example/editor"}, {"https://web.example/editor?draft=x", "https://web.example/editor?draft=x"}} {
		t.Run(tc.input, func(t *testing.T) {
			if got := s.safeRedirect(tc.input); got != tc.want {
				t.Fatalf("%q", got)
			}
		})
	}
}
func TestStrictJSONAndCORS(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	for _, body := range []string{`{} {}`, `{} garbage`, `null`, `[]`, `{"x":`} {
		r := httptest.NewRequest("POST", "/api/drafts", strings.NewReader(body))
		r.AddCookie(cookie)
		r.Header.Set("Origin", "https://web.example")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 || w.Header().Get("Access-Control-Allow-Origin") != "https://web.example" {
			t.Fatalf("%q accepted: %d %s", body, w.Code, w.Body)
		}
	}
	r := httptest.NewRequest("OPTIONS", "/api/drafts", nil)
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("untrusted CORS origin allowed")
	}
}
func TestAssetUploadAndOwnership(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("accountDID", str(a["did"]))
	_ = mw.WriteField("width", "2")
	_ = mw.WriteField("height", "3")
	part, e := mw.CreateFormFile("file", "image.png")
	if e != nil {
		t.Fatal(e)
	}
	_, _ = part.Write([]byte("image"))
	mw.Close()
	r := httptest.NewRequest("POST", "/api/assets/upload", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 415 {
		t.Fatalf("unsupported mime accepted %d", w.Code)
	}
	asset, e := s.storeAsset(context.Background(), a, []byte("PNG"), "image/png", "device", "Alt", 2, 3, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	w = requestForTest(t, s, "GET", "/api/assets/"+str(asset["id"])+"/content", nil, cookie)
	if w.Code != 200 || w.Body.String() != "PNG" || w.Header().Get("Cache-Control") != "private, max-age=3600" {
		t.Fatal(w)
	}
	other := accountForTest(t, s, "did:plc:other")
	w = requestForTest(t, s, "GET", "/api/assets/"+str(asset["id"])+"/content", nil, cookieForTest(t, s, other))
	if w.Code != 404 {
		t.Fatal("cross-account image leaked")
	}
}
func TestConfigurationDefaultsAndProductionKey(t *testing.T) {
	for _, k := range []string{"APP_PUBLIC_URL", "WEB_PUBLIC_URL", "ANYPUB_DATA_DIR", "SQLITE_PATH", "UPLOADS_DIR", "APP_ENV", "ENVIRONMENT", "TOKEN_ENCRYPTION_KEY"} {
		t.Setenv(k, "")
	}
	c := LoadConfig()
	if c.PublicURL != "http://localhost:8080" || c.WebURL != "http://localhost:3000" || c.SQLitePath != "data/anypub.sqlite" {
		t.Fatalf("%#v", c)
	}
	c.Production = true
	if _, e := New(c); e == nil {
		t.Fatal("production started without encryption key")
	}
	if date(float64(1700000000)).Year() != 2023 || iso(nil) != nil {
		t.Fatal("date conversion")
	}
	if _, e := timestamp("bad"); e == nil {
		t.Fatal("bad timestamp accepted")
	}
	_ = time.Second
}
