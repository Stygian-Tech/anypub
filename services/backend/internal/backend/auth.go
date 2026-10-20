package backend

import (
	"context"
	"encoding/json"
	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) metadata(w http.ResponseWriter, r *http.Request) (any, error) {
	m := s.AT.ClientMetadata("")
	m["client_name"] = s.Config.ClientName
	for k, v := range map[string]string{"logo_uri": s.Config.LogoURL, "tos_uri": s.Config.TOSURL, "policy_uri": s.Config.PolicyURL} {
		if v != "" {
			m[k] = v
		}
	}
	return m, nil
}
func (s *Server) safeRedirect(target string) string {
	u, e := url.Parse(target)
	if e != nil || u.User != nil || u.Fragment != "" {
		return s.Config.WebURL
	}
	origin := u.Scheme + "://" + u.Host
	for _, a := range append(s.Config.AllowedOrigins, s.Config.WebURL) {
		if origin == strings.TrimRight(strings.TrimSpace(a), "/") {
			return target
		}
	}
	return s.Config.WebURL
}
func (s *Server) authStart(w http.ResponseWriter, r *http.Request) (any, error) {
	in, e := decode(r)
	if e != nil {
		return nil, e
	}
	if str(in["handle"]) == "" {
		return nil, fail(400, "Missing handle")
	}
	start, e := s.AT.StartOAuth(r.Context(), str(in["handle"]), s.AT.CallbackURL())
	if e != nil {
		return nil, wrapError(e)
	}
	t := token()
	session := Row{"token_hash": hash(t), "created_at": now(), "updated_at": now(), "expires_at": now() + 30*86400}
	if e = s.Store.Save(r.Context(), "browser_sessions", session); e != nil {
		return nil, e
	}
	verifier, e := s.AT.Encrypt(start.CodeVerifier)
	if e != nil {
		return nil, e
	}
	key := object(parsedString(start.DPoPPrivateKey))
	key["nonce"] = start.DPoPNonce
	encrypted, e := s.AT.Encrypt(jsonString(key))
	if e != nil {
		return nil, e
	}
	state := Row{"state": start.State, "handle": start.Handle, "code_verifier": verifier, "redirect_url": s.safeRedirect(str(in["redirectURL"])), "authorization_server": start.Issuer, "token_endpoint": start.TokenEndpoint, "pds_url": start.PDSURL, "dpop_key_json": encrypted, "expected_did": start.DID, "browser_session_id": session["id"], "created_at": now(), "expires_at": float64(start.ExpiresAt.Unix())}
	if e = s.Store.Save(r.Context(), "oauth_states", state); e != nil {
		return nil, e
	}
	s.cookie(w, t)
	return Row{"state": start.State, "scopes": start.Scopes, "authorizationURL": start.AuthorizationURL, "codeChallenge": start.CodeChallenge, "codeChallengeMethod": "S256"}, nil
}
func parsedString(s string) any { var out any; _ = json.Unmarshal([]byte(s), &out); return out }
func (s *Server) authCallback(w http.ResponseWriter, r *http.Request) (any, error) {
	q := r.URL.Query()
	if q.Get("state") == "" || q.Get("code") == "" || q.Get("iss") == "" {
		return nil, fail(400, "Missing OAuth state or code")
	}
	state, e := s.Store.One(r.Context(), "oauth_states", "WHERE state=?", q.Get("state"))
	if e != nil {
		return nil, fail(400, "Unknown OAuth state")
	}
	if !date(state["expires_at"]).After(time.Now()) {
		_ = s.Store.Delete(r.Context(), "oauth_states", str(state["id"]))
		return nil, fail(400, "OAuth state expired")
	}
	session, e := s.session(r)
	if e != nil {
		return nil, e
	}
	if session["id"] != state["browser_session_id"] {
		return nil, fail(401, "OAuth callback does not belong to this browser session")
	}
	if q.Get("iss") != state["authorization_server"] {
		return nil, fail(400, "OAuth callback issuer or state metadata is invalid")
	}
	verifier, e := s.AT.Decrypt(str(state["code_verifier"]))
	if e != nil {
		return nil, e
	}
	key, e := s.AT.Decrypt(str(state["dpop_key_json"]))
	if e != nil {
		return nil, e
	}
	start := atproto.OAuthStart{State: str(state["state"]), Handle: str(state["handle"]), CodeVerifier: verifier, DPoPPrivateKey: key, DPoPNonce: str(object(parsedString(key))["nonce"]), DID: str(state["expected_did"]), PDSURL: str(state["pds_url"]), TokenEndpoint: str(state["token_endpoint"]), Issuer: str(state["authorization_server"]), RedirectURI: s.AT.CallbackURL(), Scopes: atproto.CMSScopes, ExpiresAt: date(state["expires_at"])}
	result, e := s.Store.DB.ExecContext(r.Context(), "DELETE FROM oauth_states WHERE id=?", state["id"])
	if e != nil {
		return nil, e
	}
	n, e := result.RowsAffected()
	if e != nil || n != 1 {
		return nil, fail(400, "OAuth state already consumed")
	}
	completion, e := s.AT.FinishOAuth(r.Context(), start, q.Get("code"), q.Get("iss"))
	if e != nil {
		return nil, wrapError(e)
	}
	s.accountMu.Lock()
	a, _ := s.Store.One(r.Context(), "linked_accounts", "WHERE did=?", completion.DID)
	if a == nil {
		a = Row{"did": completion.DID, "linked_at": now()}
	}
	e = s.persistSession(r.Context(), a, completion)
	s.accountMu.Unlock()
	if e != nil {
		return nil, e
	}
	session["account_did"] = completion.DID
	session["updated_at"] = now()
	session["expires_at"] = now() + 30*86400
	if e = s.Store.Save(r.Context(), "browser_sessions", session); e != nil {
		return nil, e
	}
	_, _ = s.discover(r.Context(), a)
	http.Redirect(w, r, s.safeRedirect(str(state["redirect_url"])), http.StatusSeeOther)
	return sentResponse{}, nil
}

type sentResponse struct{}

func (s *Server) loadSession(a Row) (atproto.Session, error) {
	access, e := s.AT.Decrypt(str(a["access_token"]))
	if e != nil {
		return atproto.Session{}, e
	}
	refresh, e := s.AT.Decrypt(str(a["refresh_token"]))
	if e != nil {
		return atproto.Session{}, e
	}
	key, e := s.AT.Decrypt(str(a["dpop_key_json"]))
	if e != nil {
		return atproto.Session{}, e
	}
	extras := object(parsedString(key))
	return atproto.Session{DID: str(a["did"]), Handle: str(a["handle"]), PDSURL: str(a["pds_url"]), AccessToken: access, RefreshToken: refresh, TokenType: "DPoP", DPoPPrivateKey: key, DPoPNonce: str(extras["nonce"]), TokenEndpoint: str(a["token_endpoint"]), Issuer: str(extras["issuer"]), Scopes: str(a["scope"]), ExpiresAt: date(extras["expiresAt"])}, nil
}
func (s *Server) persistSession(ctx context.Context, a Row, session atproto.Session) error {
	access, e := s.AT.Encrypt(session.AccessToken)
	if e != nil {
		return e
	}
	refresh, e := s.AT.Encrypt(session.RefreshToken)
	if e != nil {
		return e
	}
	key := object(parsedString(session.DPoPPrivateKey))
	key["nonce"] = session.DPoPNonce
	key["issuer"] = session.Issuer
	if !session.ExpiresAt.IsZero() {
		key["expiresAt"] = session.ExpiresAt.Format(time.RFC3339Nano)
	}
	sealed, e := s.AT.Encrypt(jsonString(key))
	if e != nil {
		return e
	}
	a["did"] = session.DID
	a["handle"] = session.Handle
	a["pds_url"] = session.PDSURL
	a["scope"] = session.Scopes
	a["access_token"] = access
	a["refresh_token"] = refresh
	a["dpop_key_json"] = sealed
	a["token_endpoint"] = session.TokenEndpoint
	a["updated_at"] = now()
	return s.Store.Save(ctx, "linked_accounts", a)
}
func (s *Server) rpc(ctx context.Context, a Row, method, nsid string, q url.Values, input, output any) error {
	// Refresh tokens rotate. Serialize reads of stored credentials and persist every
	// mutation before releasing the lock, including nonce changes on failed writes.
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	fresh, e := s.Store.One(ctx, "linked_accounts", "WHERE did=?", a["did"])
	if e != nil {
		return e
	}
	session, e := s.loadSession(fresh)
	if e != nil {
		return e
	}
	callErr := s.AT.XRPC(ctx, &session, method, nsid, q, input, output)
	saveErr := s.persistSession(ctx, fresh, session)
	if saveErr != nil {
		return saveErr
	}
	return callErr
}
func (s *Server) uploadBlob(ctx context.Context, a Row, data []byte, mime string) (Row, error) {
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	fresh, e := s.Store.One(ctx, "linked_accounts", "WHERE did=?", a["did"])
	if e != nil {
		return nil, e
	}
	session, e := s.loadSession(fresh)
	if e != nil {
		return nil, e
	}
	blob, callErr := s.AT.UploadBlob(ctx, &session, data, mime)
	if e = s.persistSession(ctx, fresh, session); e != nil {
		return nil, e
	}
	return blob, callErr
}
func accountResponse(a Row) Row {
	r := Row{}
	for _, k := range []string{"id", "did", "handle", "display_name", "pds_url", "scope", "linked_at", "updated_at"} {
		v := a[k]
		if strings.HasSuffix(k, "_at") {
			v = iso(v)
		}
		r[snakeToCamel(k)] = v
	}
	r["avatarURL"] = blobURL(a, a["avatar_cid"])
	return r
}
func (s *Server) accounts(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	var page struct {
		Records []RepositoryRecord `json:"records"`
	}
	if e = s.publicRPC(r.Context(), a, "com.atproto.repo.listRecords", url.Values{"repo": {str(a["did"])}, "collection": {"app.bsky.actor.profile"}, "limit": {"1"}}, &page); e == nil {
		for _, record := range page.Records {
			if record.URI == "at://"+str(a["did"])+"/app.bsky.actor.profile/self" {
				a["display_name"] = record.Value["displayName"]
				a["avatar_cid"] = nullable(blobCID(record.Value["avatar"]))
				a["updated_at"] = now()
				_ = s.Store.Save(r.Context(), "linked_accounts", a)
			}
		}
	}
	return []Row{accountResponse(a)}, nil
}
func (s *Server) unlink(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	if e = requireDID(a, r.PathValue("did")); e != nil {
		return nil, e
	}
	session, e := s.session(r)
	if e != nil {
		return nil, e
	}
	if e = s.Store.Delete(r.Context(), "browser_sessions", str(session["id"])); e != nil {
		return nil, e
	}
	s.cookie(w, "")
	return nil, nil
}
