package atproto

import (
	"context"
	"encoding/json"
	"errors"
	"mime"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var nsidPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*){2,}$`)

// XRPC updates session with rotated tokens and nonces. Callers must persist those
// updates even on errors, and coordinate concurrent requests for the same session.
func (c *Client) XRPC(ctx context.Context, session *Session, method, nsid string, query url.Values, input, output any) error {
	var body []byte
	var err error
	if input != nil {
		body, err = json.Marshal(input)
		if err != nil {
			return err
		}
	}
	return c.xrpc(ctx, session, method, nsid, query, body, "application/json", output)
}

// UploadBlob returns the blob reference itself (the response's "blob" field).
func (c *Client) UploadBlob(ctx context.Context, session *Session, data []byte, contentType string) (map[string]any, error) {
	if _, _, err := mime.ParseMediaType(contentType); err != nil {
		return nil, err
	}
	var response struct {
		Blob map[string]any `json:"blob"`
	}
	err := c.xrpc(ctx, session, "POST", "com.atproto.repo.uploadBlob", nil, data, contentType, &response)
	if err == nil && response.Blob == nil {
		err = errors.New("PDS returned no blob reference")
	}
	return response.Blob, err
}
func (c *Client) xrpc(ctx context.Context, session *Session, method, nsid string, query url.Values, body []byte, contentType string, out any) error {
	if session == nil {
		return errors.New("XRPC requires a session with a PDS URL")
	}
	if !nsidPattern.MatchString(nsid) {
		return errors.New("invalid XRPC NSID")
	}
	method = strings.ToUpper(method)
	if method != "GET" && method != "POST" {
		return errors.New("unsupported XRPC HTTP method")
	}
	if method == "GET" && len(body) > 0 {
		return errors.New("XRPC GET cannot have a body")
	}
	pds, err := endpoint(session.PDSURL, true)
	if err != nil {
		return err
	}
	target := pds + "/xrpc/" + nsid
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	authenticated := session.AccessToken != ""
	if !authenticated && method == "POST" {
		return errors.New("XRPC writes require authentication")
	}
	refreshed := false
	if authenticated && !session.ExpiresAt.IsZero() && !session.ExpiresAt.After(time.Now()) {
		updated, e := c.Refresh(ctx, *session)
		if e != nil {
			return e
		}
		*session = updated
		refreshed = true
	}
	for attempt := 0; attempt < 4; attempt++ {
		headers := map[string]string{"Accept": "application/json"}
		if method == "POST" {
			headers["Content-Type"] = contentType
		}
		if authenticated {
			if session.TokenType != "" && !strings.EqualFold(session.TokenType, "DPoP") {
				return errors.New("unsupported session token type")
			}
			proof, e := DPoPProof(session.DPoPPrivateKey, method, target, session.AccessToken, session.DPoPNonce)
			if e != nil {
				return e
			}
			headers["Authorization"] = "DPoP " + session.AccessToken
			headers["DPoP"] = proof
		}
		b, h, status, e := c.request(ctx, method, target, body, headers)
		if e != nil {
			return e
		}
		if authenticated {
			nonce := h.Get("DPoP-Nonce")
			if nonce == "" {
				return errors.New("PDS omitted required DPoP nonce")
			}
			session.DPoPNonce = nonce
		}
		if status >= 200 && status < 300 {
			if out == nil || len(b) == 0 {
				return nil
			}
			if raw, ok := out.(*[]byte); ok {
				*raw = b
				return nil
			}
			return json.Unmarshal(b, out)
		}
		failure := responseError(status, b)
		if authenticated && failure.Code == "use_dpop_nonce" {
			continue
		}
		if authenticated && status == 401 && !refreshed {
			updated, e := c.Refresh(ctx, *session)
			if e != nil {
				return e
			}
			*session = updated
			refreshed = true
			continue
		}
		return failure
	}
	return errors.New("PDS authentication retries exhausted")
}
