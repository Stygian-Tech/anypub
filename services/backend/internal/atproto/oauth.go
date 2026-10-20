package atproto

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"strings"
	"time"
)

type serverMetadata struct {
	Issuer                  string   `json:"issuer"`
	AuthorizationEndpoint   string   `json:"authorization_endpoint"`
	TokenEndpoint           string   `json:"token_endpoint"`
	PAREndpoint             string   `json:"pushed_authorization_request_endpoint"`
	Scopes                  []string `json:"scopes_supported"`
	DPoPAlgorithms          []string `json:"dpop_signing_alg_values_supported"`
	ClientMetadataSupported bool     `json:"client_id_metadata_document_supported"`
}

func (c *Client) StartOAuth(ctx context.Context, identifier, redirectURI string) (OAuthStart, error) {
	var start OAuthStart
	identity, err := c.ResolveIdentity(ctx, identifier)
	if err != nil {
		return start, err
	}
	var resource struct {
		Servers []string `json:"authorization_servers"`
	}
	if err = c.getJSON(ctx, identity.PDSURL+"/.well-known/oauth-protected-resource", &resource); err != nil {
		return start, err
	}
	if len(resource.Servers) == 0 {
		return start, errors.New("PDS advertises no authorization server")
	}
	issuer, err := endpoint(resource.Servers[0], true)
	if err != nil {
		return start, err
	}
	var metadata serverMetadata
	if err = c.getJSON(ctx, issuer+"/.well-known/oauth-authorization-server", &metadata); err != nil {
		return start, err
	}
	if metadata.Issuer != issuer || !slices.Contains(metadata.Scopes, "atproto") || !slices.Contains(metadata.DPoPAlgorithms, "ES256") || !metadata.ClientMetadataSupported {
		return start, errors.New("authorization server does not satisfy ATProto OAuth profile")
	}
	for _, target := range []string{metadata.AuthorizationEndpoint, metadata.TokenEndpoint, metadata.PAREndpoint} {
		if _, err = endpoint(target, false); err != nil {
			return start, err
		}
	}
	if redirectURI == "" {
		redirectURI = c.CallbackURL()
	}
	u, err := url.Parse(redirectURI)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))) {
		return start, errors.New("invalid OAuth redirect URI")
	}
	state, err := randomString(32)
	if err != nil {
		return start, err
	}
	verifier, challenge, err := NewPKCE()
	if err != nil {
		return start, err
	}
	key, err := NewDPoPKey()
	if err != nil {
		return start, err
	}
	values := url.Values{"client_id": {c.ClientID()}, "redirect_uri": {redirectURI}, "response_type": {"code"}, "scope": {CMSScopes}, "state": {state}, "code_challenge": {challenge}, "code_challenge_method": {"S256"}, "login_hint": {strings.TrimSpace(identifier)}}
	var par struct {
		RequestURI string `json:"request_uri"`
		ExpiresIn  int64  `json:"expires_in"`
	}
	nonce, err := c.postForm(ctx, metadata.PAREndpoint, values, key, "", &par)
	if err != nil {
		return start, err
	}
	if par.RequestURI == "" || par.ExpiresIn <= 0 {
		return start, errors.New("invalid PAR response")
	}
	authURL, _ := url.Parse(metadata.AuthorizationEndpoint)
	q := authURL.Query()
	q.Set("client_id", c.ClientID())
	q.Set("request_uri", par.RequestURI)
	authURL.RawQuery = q.Encode()
	// PAR request_uri expiry applies to starting authorization, not completing it.
	start = OAuthStart{State: state, AuthorizationURL: authURL.String(), CodeVerifier: verifier, CodeChallenge: challenge, DPoPPrivateKey: key, DID: identity.DID, Handle: identity.Handle, PDSURL: identity.PDSURL, TokenEndpoint: metadata.TokenEndpoint, Issuer: issuer, RedirectURI: redirectURI, Scopes: CMSScopes, ExpiresAt: time.Now().Add(10 * time.Minute)}
	if sameOrigin(metadata.PAREndpoint, metadata.TokenEndpoint) {
		start.DPoPNonce = nonce
	}
	return start, nil
}
func (c *Client) postForm(ctx context.Context, target string, values url.Values, key, nonce string, out any) (string, error) {
	for attempt := 0; attempt < 2; attempt++ {
		proof, err := DPoPProof(key, "POST", target, "", nonce)
		if err != nil {
			return "", err
		}
		b, h, status, err := c.request(ctx, "POST", target, []byte(values.Encode()), map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "DPoP": proof})
		if err != nil {
			return "", err
		}
		next := h.Get("DPoP-Nonce")
		if next == "" {
			return "", errors.New("OAuth server omitted required DPoP nonce")
		}
		if status >= 200 && status < 300 {
			return next, json.Unmarshal(b, out)
		}
		e := responseError(status, b)
		if attempt == 0 && e.Code == "use_dpop_nonce" {
			nonce = next
			continue
		}
		return "", e
	}
	return "", errors.New("OAuth nonce retry exhausted")
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	Subject      string `json:"sub"`
	ExpiresIn    int64  `json:"expires_in"`
}

func validateToken(token tokenResponse, did string) error {
	if token.AccessToken == "" || !strings.EqualFold(token.TokenType, "DPoP") || token.Subject != did || !slices.Contains(strings.Fields(token.Scope), "atproto") || token.ExpiresIn < 0 || token.ExpiresIn > 315360000 {
		return errors.New("invalid ATProto OAuth token")
	}
	return nil
}
func (c *Client) FinishOAuth(ctx context.Context, start OAuthStart, code, issuer string) (Session, error) {
	var session Session
	if issuer == "" || issuer != start.Issuer || code == "" || start.DID == "" || start.CodeVerifier == "" || start.State == "" || start.RedirectURI == "" || !start.ExpiresAt.After(time.Now()) {
		return session, errors.New("invalid or expired OAuth callback state")
	}
	var token tokenResponse
	nonce, err := c.postForm(ctx, start.TokenEndpoint, url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {start.RedirectURI}, "client_id": {c.ClientID()}, "code_verifier": {start.CodeVerifier}}, start.DPoPPrivateKey, start.DPoPNonce, &token)
	if err != nil {
		return session, err
	}
	if err = validateToken(token, start.DID); err != nil {
		return session, err
	}
	session = Session{DID: start.DID, Handle: start.Handle, PDSURL: start.PDSURL, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, TokenType: token.TokenType, DPoPPrivateKey: start.DPoPPrivateKey, TokenEndpoint: start.TokenEndpoint, Issuer: start.Issuer, Scopes: token.Scope}
	if token.ExpiresIn > 0 {
		session.ExpiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	if sameOrigin(start.TokenEndpoint, start.PDSURL) {
		session.DPoPNonce = nonce
	}
	return session, nil
}
func (c *Client) Refresh(ctx context.Context, session Session) (Session, error) {
	if session.RefreshToken == "" || session.TokenEndpoint == "" || session.DID == "" {
		return session, errors.New("session must be reauthorized before refreshing")
	}
	var token tokenResponse
	nonce := ""
	if sameOrigin(session.TokenEndpoint, session.PDSURL) {
		nonce = session.DPoPNonce
	}
	nonce, err := c.postForm(ctx, session.TokenEndpoint, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {session.RefreshToken}, "client_id": {c.ClientID()}}, session.DPoPPrivateKey, nonce, &token)
	if err != nil {
		return session, err
	}
	if err = validateToken(token, session.DID); err != nil {
		return session, err
	}
	session.AccessToken = token.AccessToken
	if token.RefreshToken != "" {
		session.RefreshToken = token.RefreshToken
	}
	session.TokenType = token.TokenType
	session.Scopes = token.Scope
	session.ExpiresAt = time.Time{}
	if token.ExpiresIn > 0 {
		session.ExpiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	if sameOrigin(session.TokenEndpoint, session.PDSURL) {
		session.DPoPNonce = nonce
	}
	return session, nil
}
func sameOrigin(a, b string) bool {
	x, e := url.Parse(a)
	y, f := url.Parse(b)
	if e != nil || f != nil || x.Host == "" || y.Host == "" {
		return false
	}
	port := func(u *url.URL) string {
		if u.Port() != "" {
			return u.Port()
		}
		if u.Scheme == "https" {
			return "443"
		}
		return "80"
	}
	return strings.EqualFold(x.Scheme, y.Scheme) && strings.EqualFold(x.Hostname(), y.Hostname()) && port(x) == port(y)
}
