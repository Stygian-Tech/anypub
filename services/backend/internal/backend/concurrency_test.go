package backend

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLegacyFluentBrowserSessionAndInflightOAuth(t *testing.T) {
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
	s, e := New(Config{PublicURL: "https://api.example", WebURL: "https://web.example", DataDir: dir, UploadsDir: filepath.Join(dir, "uploads"), SQLitePath: path})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	a := accountForTest(t, s, "did:plc:writer")
	cookieToken := "swift-issued-browser-token"
	sum := sha256.Sum256([]byte(cookieToken))
	legacyHash := base64.StdEncoding.EncodeToString(sum[:])
	sessionID := "FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF"
	_, e = s.Store.DB.Exec(`INSERT INTO browser_sessions(id,token_hash,account_did,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?)`, sessionID, legacyHash, a["did"], 1700000000.0, 1700000000.0, now()+600)
	if e != nil {
		t.Fatal(e)
	}
	cookie := &http.Cookie{Name: "anypub_session", Value: cookieToken}
	w := requestForTest(t, s, "GET", "/api/drafts", nil, cookie)
	if w.Code != 200 {
		t.Fatalf("legacy browser cookie rejected: %d %s", w.Code, w.Body)
	}
	saveForTest(t, s, "oauth_states", Row{"state": "legacy-inflight", "handle": "writer.example", "code_verifier": "plain:eA==", "redirect_url": "https://web.example/editor", "authorization_server": "https://auth.example", "browser_session_id": sessionID, "created_at": now(), "expires_at": now() + 600})
	w = requestForTest(t, s, "GET", "/api/auth/atproto/callback?state=legacy-inflight&code=x&iss=https://wrong.example", nil, cookie)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "issuer") {
		t.Fatalf("legacy callback did not authenticate owning browser: %d %s", w.Code, w.Body)
	}
	_, e = s.Store.DB.Exec("UPDATE browser_sessions SET token_hash=? WHERE id=?", hexHash(cookieToken), sessionID)
	if e != nil {
		t.Fatal(e)
	}
	if requestForTest(t, s, "GET", "/api/drafts", nil, cookie).Code != 200 {
		t.Fatal("earlier Go hex cookie not accepted")
	}
}
func TestProfileRefreshDoesNotRestoreStaleCredentials(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	started, release := make(chan struct{}), make(chan struct{})
	s.AT.HTTPClient = &http.Client{Transport: backendRoundTripper(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return wireForTest(200, Row{"records": []any{Row{"uri": "at://did:plc:writer/app.bsky.actor.profile/self", "value": Row{"displayName": "New Profile", "avatar": Row{"ref": Row{"$link": "avatar"}}}}}}), nil
	})}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- requestForTest(t, s, "GET", "/api/accounts", nil, cookie) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("profile did not start")
	}
	s.accountMu.Lock()
	fresh, e := s.Store.One(context.Background(), "linked_accounts", "WHERE did=?", a["did"])
	if e != nil {
		t.Fatal(e)
	}
	session, e := s.loadSession(fresh)
	if e != nil {
		t.Fatal(e)
	}
	session.AccessToken = "rotated-access"
	session.RefreshToken = "rotated-refresh"
	session.DPoPNonce = "rotated-nonce"
	if e = s.persistSession(context.Background(), fresh, session); e != nil {
		t.Fatal(e)
	}
	s.accountMu.Unlock()
	close(release)
	select {
	case w := <-done:
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("profile request hung")
	}
	stored, e := s.Store.One(context.Background(), "linked_accounts", "WHERE did=?", a["did"])
	if e != nil {
		t.Fatal(e)
	}
	current, e := s.loadSession(stored)
	if e != nil {
		t.Fatal(e)
	}
	if current.AccessToken != "rotated-access" || current.RefreshToken != "rotated-refresh" || current.DPoPNonce != "rotated-nonce" || stored["display_name"] != "New Profile" {
		t.Fatalf("profile overwrote credential rotation: %#v", current)
	}
}
func TestDeleteWaitsForPublishAndCannotResurrectDraft(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	d := draftForTest(t, s, a, "markpub")
	cookie := cookieForTest(t, s, a)
	p := attachPDS(t, s, a)
	_ = p
	original := s.AT.HTTPClient.Transport
	started, release := make(chan struct{}), make(chan struct{})
	s.AT.HTTPClient.Transport = backendRoundTripper(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/com.atproto.repo.createRecord") {
			select {
			case <-started:
			default:
				close(started)
				<-release
			}
		}
		return original.RoundTrip(r)
	})
	published := make(chan error, 1)
	go func() { _, e := s.Publish(context.Background(), d); published <- e }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("publish did not start")
	}
	deleted := make(chan *httptest.ResponseRecorder, 1)
	go func() { deleted <- requestForTest(t, s, "DELETE", "/api/drafts/"+str(d["id"]), nil, cookie) }()
	select {
	case w := <-deleted:
		t.Fatalf("delete bypassed publish transaction: %d", w.Code)
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	select {
	case e := <-published:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("publish hung")
	}
	select {
	case w := <-deleted:
		if w.Code != 204 {
			t.Fatalf("delete failed: %d %s", w.Code, w.Body)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("delete deadlocked")
	}
	_, e := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
	if !errors.Is(e, sql.ErrNoRows) {
		t.Fatalf("deleted draft resurrected: %v", e)
	}
	if _, ok := p.records["site.standard.document/generated"]; ok {
		t.Fatal("delete did not remove completed publication")
	}
}
