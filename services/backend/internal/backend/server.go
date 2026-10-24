package backend

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
)

type Config struct {
	PublicURL, WebURL, DataDir, SQLitePath, UploadsDir, EncryptionKey, UnsplashKey, ClientName, LogoURL, TOSURL, PolicyURL string
	AllowedOrigins                                                                                                         []string
	Production                                                                                                             bool
}

func LoadConfig() Config {
	env := func(k, d string) string {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
		return d
	}
	d := env("ANYPUB_DATA_DIR", "data")
	web := strings.TrimRight(env("WEB_PUBLIC_URL", "http://localhost:3000"), "/")
	return Config{PublicURL: strings.TrimRight(env("APP_PUBLIC_URL", "http://localhost:8080"), "/"), WebURL: web, DataDir: d, SQLitePath: env("SQLITE_PATH", filepath.Join(d, "anypub.sqlite")), UploadsDir: env("UPLOADS_DIR", filepath.Join(d, "uploads")), EncryptionKey: env("TOKEN_ENCRYPTION_KEY", ""), UnsplashKey: env("UNSPLASH_ACCESS_KEY", ""), ClientName: env("OAUTH_CLIENT_NAME", "AnyPub"), LogoURL: env("OAUTH_CLIENT_LOGO_URL", ""), TOSURL: env("OAUTH_CLIENT_TOS_URL", ""), PolicyURL: env("OAUTH_CLIENT_POLICY_URL", ""), AllowedOrigins: strings.Split(env("ALLOWED_ORIGINS", web), ","), Production: env("ENVIRONMENT", env("APP_ENV", "development")) == "production"}
}

type Server struct {
	Store     *Store
	Config    Config
	AT        *atproto.Client
	HTTP      *http.Client
	mux       *http.ServeMux
	publishMu sync.Mutex
	importMu  sync.Mutex
	accountMu sync.Mutex
}
type apiError struct {
	Status int
	Reason string
}

func (e *apiError) Error() string          { return e.Reason }
func fail(status int, reason string) error { return &apiError{status, reason} }

type endpoint func(http.ResponseWriter, *http.Request) (any, error)

func New(c Config) (*Server, error) {
	if c.Production {
		key, e := base64.StdEncoding.DecodeString(c.EncryptionKey)
		if e != nil || len(key) < 32 {
			return nil, errors.New("TOKEN_ENCRYPTION_KEY must be valid base64 containing at least 32 bytes in production")
		}
	}
	for _, d := range []string{c.DataDir, c.UploadsDir, filepath.Dir(c.SQLitePath)} {
		if d != "" {
			if e := os.MkdirAll(d, 0700); e != nil {
				return nil, e
			}
		}
	}
	st, e := OpenStore(c.SQLitePath)
	if e != nil {
		return nil, e
	}
	s := &Server{Store: st, Config: c, AT: atproto.New(atproto.Config{PublicBaseURL: c.PublicURL, TokenEncryptionKey: c.EncryptionKey}), HTTP: &http.Client{Timeout: 30 * time.Second}, mux: http.NewServeMux()}
	s.routes()
	return s, nil
}
func (s *Server) Close() error                         { return s.Store.DB.Close() }
func (s *Server) Mount(pattern string, h http.Handler) { s.mux.Handle(pattern, h) }
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	for _, allowed := range s.Config.AllowedOrigins {
		if origin != "" && origin == strings.TrimRight(strings.TrimSpace(allowed), "/") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
			break
		}
	}
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, Origin, X-Requested-With")
		w.WriteHeader(204)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	s.mux.ServeHTTP(w, r)
}
func (s *Server) route(pattern string, h endpoint) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		result, e := h(w, r)
		if e != nil {
			status := 500
			reason := "Internal Server Error"
			var ae *apiError
			if errors.As(e, &ae) {
				status = ae.Status
				reason = ae.Reason
			} else if errors.Is(e, context.Canceled) {
				status = 499
				reason = "Request canceled"
			} else {
				slog.Error("API request failed", "path", r.URL.Path, "error", e)
			}
			writeJSON(w, status, Row{"error": true, "reason": reason})
			return
		}
		if _, sent := result.(sentResponse); sent {
			return
		}
		if result == nil {
			w.WriteHeader(204)
			return
		}
		writeJSON(w, 200, result)
	})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func decode(r *http.Request) (Row, error) {
	var input Row
	d := json.NewDecoder(r.Body)
	if e := d.Decode(&input); e != nil {
		return nil, fail(400, "Invalid request body")
	}
	if input == nil {
		return nil, fail(400, "Expected a JSON object")
	}
	var extra any
	if e := d.Decode(&extra); e != io.EOF {
		return nil, fail(400, "Expected one JSON object")
	}
	return input, nil
}
func (s *Server) routes() {
	s.route("GET /health", func(w http.ResponseWriter, r *http.Request) (any, error) { return Row{"ok": true}, nil })
	s.route("GET /oauth/client-metadata.json", s.metadata)
	s.route("GET /oauth/jwks.json", func(w http.ResponseWriter, r *http.Request) (any, error) { return Row{"keys": []any{}}, nil })
	s.route("POST /api/auth/atproto/start", s.authStart)
	s.route("GET /api/auth/atproto/callback", s.authCallback)
	s.route("GET /api/accounts", s.accounts)
	s.route("DELETE /api/accounts/{did}", s.unlink)
	s.route("GET /api/publications", s.publications)
	s.route("POST /api/publications/sync", s.syncPublications)
	s.route("GET /api/drafts", s.drafts)
	s.route("POST /api/drafts", s.createDraft)
	s.route("POST /api/drafts/backfill", s.backfill)
	s.route("GET /api/drafts/{id}", s.getDraft)
	s.route("PUT /api/drafts/{id}", s.updateDraft)
	s.route("PATCH /api/drafts/{id}/publication", s.changePublication)
	s.route("POST /api/drafts/{id}/schedule", s.schedule)
	s.route("POST /api/drafts/{id}/publish", s.publishHTTP)
	s.route("POST /api/drafts/{id}/unpublish", s.unpublishHTTP)
	s.route("POST /api/drafts/{id}/revert", s.revert)
	s.route("DELETE /api/drafts/{id}", s.deleteDraft)
	s.route("GET /api/calendar", s.calendar)
	s.route("GET /api/assets", s.assets)
	s.route("POST /api/assets/upload", s.upload)
	s.route("GET /api/assets/{id}/content", s.assetContent)
	s.route("GET /api/unsplash/search", s.unsplashSearch)
	s.route("POST /api/unsplash/select", s.unsplashSelect)
	s.route("GET /api/feedback/board", s.feedbackBoard)
	s.route("POST /api/feedback", s.feedback)
	s.route("GET /api/research", s.research)
}
func token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func hash(t string) string {
	h := sha256.Sum256([]byte(t))
	return base64.StdEncoding.EncodeToString(h[:])
}
func hexHash(t string) string { h := sha256.Sum256([]byte(t)); return hex.EncodeToString(h[:]) }
func (s *Server) session(r *http.Request) (Row, error) {
	c, e := r.Cookie("anypub_session")
	if e != nil {
		return nil, fail(401, "Sign in to continue")
	}
	row, e := s.Store.One(r.Context(), "browser_sessions", "WHERE token_hash IN (?,?)", hash(c.Value), hexHash(c.Value))
	if e != nil {
		return nil, fail(401, "Sign in to continue")
	}
	if !date(row["expires_at"]).After(time.Now()) {
		_ = s.Store.Delete(r.Context(), "browser_sessions", str(row["id"]))
		return nil, fail(401, "Sign in to continue")
	}
	return row, nil
}
func (s *Server) account(r *http.Request) (Row, error) {
	session, e := s.session(r)
	if e != nil {
		return nil, e
	}
	a, e := s.Store.One(r.Context(), "linked_accounts", "WHERE did=?", session["account_did"])
	if e != nil {
		return nil, fail(401, "Sign in to continue")
	}
	if claimed := r.URL.Query().Get("accountDID"); claimed != "" && claimed != a["did"] {
		return nil, fail(403, "The requested account does not belong to this session")
	}
	return a, nil
}
func requireDID(a Row, did any) error {
	if a["did"] != did {
		return fail(403, "The requested account does not belong to this session")
	}
	return nil
}
func (s *Server) cookie(w http.ResponseWriter, t string) {
	maxAge := 30 * 24 * 3600
	expires := time.Now().Add(time.Duration(maxAge) * time.Second)
	if t == "" {
		maxAge = -1
		expires = time.Unix(0, 0)
	}
	http.SetCookie(w, &http.Cookie{Name: "anypub_session", Value: t, Path: "/", MaxAge: maxAge, Expires: expires, Secure: strings.HasPrefix(s.Config.PublicURL, "https://"), HttpOnly: true, SameSite: http.SameSiteLaxMode})
}
func owned(uri, did, collection string) bool {
	p := strings.Split(strings.TrimPrefix(uri, "at://"), "/")
	return strings.HasPrefix(uri, "at://") && len(p) == 3 && p[0] == did && p[1] == collection && p[2] != ""
}
func ref(uri string) (string, string, string, error) {
	p := strings.Split(strings.TrimPrefix(uri, "at://"), "/")
	if !strings.HasPrefix(uri, "at://") || len(p) != 3 || p[0] == "" || p[1] == "" || p[2] == "" {
		return "", "", "", fail(400, "Invalid AT record URI")
	}
	return p[0], p[1], p[2], nil
}
func jsonString(v any) string { b, _ := json.Marshal(v); return string(b) }
func object(v any) Row {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return Row{}
}
func array(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return []any{}
}
func parsed(v any) any { var out any; _ = json.Unmarshal([]byte(str(v)), &out); return out }
func nullable(v any) any {
	if v == nil || v == "" {
		return nil
	}
	return v
}
func timestamp(v any) (float64, error) {
	t := date(v)
	if t.IsZero() {
		return 0, fail(400, "Invalid date")
	}
	return float64(t.UnixNano()) / 1e9, nil
}
func blobCID(v any) string { m := object(v); return str(object(m["ref"])["$link"]) }
func blobURL(a Row, cid any) any {
	if str(cid) == "" {
		return nil
	}
	return strings.TrimRight(str(a["pds_url"]), "/") + "/xrpc/com.atproto.sync.getBlob?did=" + str(a["did"]) + "&cid=" + str(cid)
}
func wrapError(e error) error {
	if e == nil {
		return nil
	}
	return fail(502, fmt.Sprintf("Upstream request failed: %v", e))
}
