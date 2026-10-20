package atproto

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

const CMSScopes = "atproto transition:generic include:site.standard.authFull repo:app.offprint.document.article?action=create&action=update&action=delete include:blog.pckt.authFull include:community.lexicon.calendar.authFull include:app.userinput.authFull blob:*/*"

type Config struct{ PublicBaseURL, TokenEncryptionKey string }

// HTTPClient may be replaced before use to provide a custom transport. Redirects
// are never followed by this component, including with a custom HTTPClient.
type Client struct {
	config     Config
	HTTPClient *http.Client
}

func New(config Config) *Client {
	config.PublicBaseURL = strings.TrimRight(config.PublicBaseURL, "/")
	return &Client{config: config, HTTPClient: &http.Client{Timeout: 30 * time.Second}}
}
func (c *Client) Encrypt(value string) (string, error) {
	return Encrypt(value, c.config.TokenEncryptionKey)
}
func (c *Client) Decrypt(value string) (string, error) {
	return Decrypt(value, c.config.TokenEncryptionKey)
}
func (c *Client) ClientID() string    { return c.config.PublicBaseURL + "/oauth/client-metadata.json" }
func (c *Client) CallbackURL() string { return c.config.PublicBaseURL + "/api/auth/atproto/callback" }
func (c *Client) ClientMetadata(redirectURI string) map[string]any {
	if redirectURI == "" {
		redirectURI = c.CallbackURL()
	}
	return map[string]any{"client_id": c.ClientID(), "client_name": "AnyPub", "client_uri": c.config.PublicBaseURL, "redirect_uris": []string{redirectURI}, "grant_types": []string{"authorization_code", "refresh_token"}, "scope": CMSScopes, "response_types": []string{"code"}, "application_type": "web", "token_endpoint_auth_method": "none", "dpop_bound_access_tokens": true}
}

type Identity struct {
	DID    string `json:"did"`
	Handle string `json:"handle"`
	PDSURL string `json:"pds_url"`
}

// OAuthStart must be stored server-side, bound to the browser session, and
// consumed exactly once after checking the callback state. Never send its
// verifier/private key fields to the browser. RedirectURI is the OAuth callback.
type OAuthStart struct {
	State            string    `json:"state"`
	AuthorizationURL string    `json:"authorization_url"`
	CodeVerifier     string    `json:"code_verifier"`
	CodeChallenge    string    `json:"code_challenge"`
	DPoPPrivateKey   string    `json:"dpop_private_key"`
	DPoPNonce        string    `json:"dpop_nonce"`
	DID              string    `json:"did"`
	Handle           string    `json:"handle"`
	PDSURL           string    `json:"pds_url"`
	TokenEndpoint    string    `json:"token_endpoint"`
	Issuer           string    `json:"issuer"`
	RedirectURI      string    `json:"redirect_uri"`
	Scopes           string    `json:"scopes"`
	ExpiresAt        time.Time `json:"expires_at"`
}

// Session secrets are plaintext in memory. The caller encrypts them at rest and
// serializes access to a session during XRPC/Refresh, persisting rotated tokens
// even when a subsequent PDS operation fails.
type Session struct {
	DID            string    `json:"did"`
	Handle         string    `json:"handle"`
	PDSURL         string    `json:"pds_url"`
	AccessToken    string    `json:"access_token"`
	RefreshToken   string    `json:"refresh_token"`
	TokenType      string    `json:"token_type"`
	DPoPPrivateKey string    `json:"dpop_private_key"`
	DPoPNonce      string    `json:"dpop_nonce"`
	TokenEndpoint  string    `json:"token_endpoint"`
	Issuer         string    `json:"issuer"`
	Scopes         string    `json:"scopes"`
	ExpiresAt      time.Time `json:"expires_at"`
}
type Error struct {
	StatusCode    int
	Code, Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("ATProto HTTP %d: %s %s", e.StatusCode, e.Code, e.Message)
}
func endpoint(value string, origin bool) (string, error) {
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return "", errors.New("invalid HTTPS endpoint")
	}
	if origin && (u.RawQuery != "" || (u.Path != "" && u.Path != "/")) {
		return "", errors.New("invalid HTTPS origin")
	}
	if origin {
		return strings.TrimRight(value, "/"), nil
	}
	return value, nil
}
func (c *Client) request(ctx context.Context, method, target string, body []byte, headers map[string]string) ([]byte, http.Header, int, error) {
	if _, err := endpoint(target, false); err != nil {
		return nil, nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return nil, nil, 0, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	h := c.HTTPClient
	if h == nil {
		h = &http.Client{Timeout: 30 * time.Second}
	}
	copyClient := *h
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := copyClient.Do(req)
	if err != nil {
		return nil, nil, 0, err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 32<<20+1))
	if err == nil && len(b) > 32<<20 {
		err = errors.New("ATProto response exceeds 32 MiB")
	}
	return b, res.Header, res.StatusCode, err
}
func responseError(status int, b []byte) *Error {
	var wire struct {
		Error       string `json:"error"`
		Message     string `json:"message"`
		Description string `json:"error_description"`
	}
	_ = json.Unmarshal(b, &wire)
	if wire.Message == "" {
		wire.Message = wire.Description
	}
	return &Error{status, wire.Error, wire.Message}
}
func (c *Client) getJSON(ctx context.Context, target string, out any) error {
	b, _, status, err := c.request(ctx, "GET", target, nil, map[string]string{"Accept": "application/json"})
	if err != nil {
		return err
	}
	if status != 200 {
		return responseError(status, b)
	}
	return decodeJSON(b, out)
}

var handlePattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

func (c *Client) ResolveIdentity(ctx context.Context, identifier string) (Identity, error) {
	id := strings.TrimSpace(identifier)
	handle := ""
	did := id
	if !strings.HasPrefix(id, "did:") {
		handle = strings.ToLower(strings.TrimPrefix(id, "@"))
		if len(handle) > 253 || !handlePattern.MatchString(handle) {
			return Identity{}, errors.New("invalid ATProto handle")
		}
		b, _, status, err := c.request(ctx, "GET", "https://"+handle+"/.well-known/atproto-did", nil, nil)
		if err == nil && status == 200 {
			did = strings.TrimSpace(string(b))
		}
		if !strings.HasPrefix(did, "did:plc:") && !strings.HasPrefix(did, "did:web:") {
			var r struct {
				DID string `json:"did"`
			}
			if err = c.getJSON(ctx, "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?"+url.Values{"handle": {handle}}.Encode(), &r); err != nil {
				return Identity{}, err
			}
			did = r.DID
		}
	}
	target, err := didDocumentURL(did)
	if err != nil {
		return Identity{}, err
	}
	var doc struct {
		ID          string                                       `json:"id"`
		AlsoKnownAs []string                                     `json:"alsoKnownAs"`
		Service     []struct{ ID, Type, ServiceEndpoint string } `json:"service"`
	}
	if err = c.getJSON(ctx, target, &doc); err != nil {
		return Identity{}, err
	}
	if doc.ID != did {
		return Identity{}, errors.New("DID document identity mismatch")
	}
	if handle != "" && !slices.Contains(doc.AlsoKnownAs, "at://"+handle) {
		return Identity{}, errors.New("handle does not match DID document")
	}
	if handle == "" {
		for _, a := range doc.AlsoKnownAs {
			if strings.HasPrefix(a, "at://") {
				candidate := strings.TrimPrefix(a, "at://")
				if handlePattern.MatchString(candidate) {
					handle = candidate
					break
				}
			}
		}
	}
	for _, s := range doc.Service {
		if s.ID == did+"#atproto_pds" || s.ID == "#atproto_pds" || s.Type == "AtprotoPersonalDataServer" {
			pds, err := endpoint(s.ServiceEndpoint, true)
			if err != nil {
				return Identity{}, err
			}
			return Identity{did, handle, pds}, nil
		}
	}
	return Identity{}, errors.New("DID document has no PDS")
}
func didDocumentURL(did string) (string, error) {
	if strings.HasPrefix(did, "did:plc:") {
		suffix := strings.TrimPrefix(did, "did:plc:")
		if suffix == "" || strings.ContainsAny(suffix, "/?#:%") {
			return "", errors.New("invalid PLC DID")
		}
		return "https://plc.directory/" + did, nil
	}
	if strings.HasPrefix(did, "did:web:") {
		parts := strings.Split(strings.TrimPrefix(did, "did:web:"), ":")
		host, err := url.PathUnescape(parts[0])
		if err != nil || host == "" || strings.ContainsAny(host, "/?#@") {
			return "", errors.New("invalid web DID")
		}
		path := "/.well-known/did.json"
		if len(parts) > 1 {
			for _, p := range parts[1:] {
				v, e := url.PathUnescape(p)
				if e != nil || v == "" || v == "." || v == ".." || strings.ContainsAny(v, "/\\?#") {
					return "", errors.New("invalid web DID path")
				}
			}
			path = "/" + strings.Join(parts[1:], "/") + "/did.json"
		}
		return "https://" + host + path, nil
	}
	return "", errors.New("unsupported DID method")
}

// decodeJSON preserves unknown integer fields through read/modify/write and CID generation.
func decodeJSON(data []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	return d.Decode(out)
}
