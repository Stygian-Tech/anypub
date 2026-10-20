package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/rivo/uniseg"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const feedbackBoardURI = "at://did:plc:qy5pluw2bsuq2x6albsgkvx3/app.userinput.space/3msw5mogjcr2x"
const feedbackPublicURL = "https://userinput.app/s/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msw5mogjcr2x?lang=en"
const feedbackAPIURL = "https://userinput.app/api/board/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msw5mogjcr2x"
const feedbackMissingPermission = "Your session does not include feedback permissions yet. Sign out and sign back in, then try again."

func feedbackCanCreate(scope string) bool {
	for _, token := range strings.Fields(scope) {
		name, query, _ := strings.Cut(token, "?")
		if name == "include:app.userinput.authFull" {
			return true
		}
		q, _ := url.ParseQuery(query)
		collection := name == "repo:app.userinput.discussion" || name == "repo:*"
		if name == "repo" {
			for _, c := range q["collection"] {
				collection = collection || c == "*" || c == "app.userinput.discussion"
			}
		}
		if collection {
			actions := q["action"]
			if len(actions) == 0 {
				return true
			}
			for _, action := range actions {
				if action == "create" {
					return true
				}
			}
		}
	}
	return false
}
func feedbackCanUpload(scope, mime string) bool {
	major, minor, ok := strings.Cut(mime, "/")
	if !ok || major == "" || minor == "" {
		return false
	}
	for _, token := range strings.Fields(scope) {
		name, query, _ := strings.Cut(token, "?")
		patterns := []string{}
		if strings.HasPrefix(name, "blob:") {
			patterns = append(patterns, strings.TrimPrefix(name, "blob:"))
		} else if name == "blob" {
			q, _ := url.ParseQuery(query)
			patterns = q["accept"]
		}
		for _, pattern := range patterns {
			a, b, ok := strings.Cut(pattern, "/")
			if ok && (a == "*" || a == major) && (b == "*" || b == minor) {
				return true
			}
		}
	}
	return false
}
func (s *Server) resolveFeedbackBoard(ctx context.Context) (Row, error) {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, feedbackAPIURL, nil)
	if e != nil {
		return nil, e
	}
	res, e := s.HTTP.Do(req)
	if e != nil {
		return nil, fail(502, "The feedback board is temporarily unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fail(502, "The feedback board is temporarily unavailable")
	}
	data, e := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if e != nil || len(data) > 2<<20 {
		return nil, fail(502, "The feedback board is temporarily unavailable")
	}
	var envelope struct {
		Board *struct {
			URI   string `json:"uri"`
			CID   string `json:"cid"`
			Value *struct {
				Name *string `json:"name"`
				Tags []struct {
					Label *string `json:"label"`
					Value *string `json:"value"`
				} `json:"tags"`
			} `json:"value"`
		} `json:"board"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.Board == nil || envelope.Board.URI != feedbackBoardURI || envelope.Board.CID == "" || envelope.Board.Value == nil || envelope.Board.Value.Name == nil {
		return nil, fail(502, "The feedback board returned an unexpected record")
	}
	b := envelope.Board
	tags := []Row{}
	for _, tag := range b.Value.Tags {
		if tag.Label == nil || tag.Value == nil {
			return nil, fail(502, "The feedback board returned an unexpected record")
		}
		tags = append(tags, Row{"label": *tag.Label, "value": *tag.Value})
	}
	return Row{"uri": b.URI, "cid": b.CID, "name": *b.Value.Name, "tags": tags}, nil
}
func (s *Server) feedbackBoard(w http.ResponseWriter, r *http.Request) (any, error) {
	if _, e := s.account(r); e != nil {
		return nil, e
	}
	b, e := s.resolveFeedbackBoard(r.Context())
	if e != nil {
		return nil, e
	}
	return Row{"name": b["name"], "uri": b["uri"], "tags": b["tags"], "publicURL": feedbackPublicURL}, nil
}

type feedbackInput struct {
	title, body  string
	tags, assets []string
}

func parseFeedbackInput(in Row) (feedbackInput, error) {
	out := feedbackInput{}
	title, ok := in["title"].(string)
	if !ok {
		return out, fail(400, "Invalid request body")
	}
	out.title = strings.TrimSpace(title)
	if body := in["body"]; body != nil {
		v, ok := body.(string)
		if !ok {
			return out, fail(400, "Invalid request body")
		}
		out.body = strings.TrimSpace(v)
	}
	for key, dest := range map[string]*[]string{"tags": &out.tags, "assetIDs": &out.assets} {
		values, ok := in[key].([]any)
		if !ok {
			return out, fail(400, "Invalid request body")
		}
		for _, value := range values {
			s, ok := value.(string)
			if !ok {
				return out, fail(400, "Invalid request body")
			}
			if key == "assetIDs" {
				if !feedbackUUID(s) {
					return out, fail(400, "Invalid request body")
				}
				s = strings.ToUpper(s)
			} else {
				s = strings.TrimSpace(s)
			}
			*dest = append(*dest, s)
		}
	}
	if out.title == "" {
		return out, fail(422, "Add a title for your feedback")
	}
	if uniseg.GraphemeClusterCount(out.title) > 200 {
		return out, fail(422, "Feedback titles must be 200 characters or fewer")
	}
	if uniseg.GraphemeClusterCount(out.body) > 10000 {
		return out, fail(422, "Feedback details must be 10,000 characters or fewer")
	}
	seen := map[string]bool{}
	for _, id := range out.assets {
		if seen[id] {
			return out, fail(422, "Attach up to four unique images")
		}
		seen[id] = true
	}
	if len(out.assets) > 4 {
		return out, fail(422, "Attach up to four unique images")
	}
	return out, nil
}
func feedbackUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}
func (s *Server) feedback(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	in, e := decode(r)
	if e != nil {
		return nil, e
	}
	if !feedbackCanCreate(str(a["scope"])) {
		return nil, fail(403, feedbackMissingPermission)
	}
	input, e := parseFeedbackInput(in)
	if e != nil {
		return nil, e
	}
	return s.createFeedback(r.Context(), a, input)
}
func (s *Server) createFeedback(ctx context.Context, a Row, input feedbackInput) (Row, error) {
	b, e := s.resolveFeedbackBoard(ctx)
	if e != nil {
		return nil, e
	}
	allowed := map[string]bool{}
	for _, tag := range b["tags"].([]Row) {
		allowed[str(tag["value"])] = true
	}
	seen := map[string]bool{}
	for _, tag := range input.tags {
		if seen[tag] || !allowed[tag] {
			return nil, fail(422, "Select only tags configured on the feedback board")
		}
		seen[tag] = true
	}
	images := []Row{}
	for _, id := range input.assets {
		asset, e := s.Store.One(ctx, "cover_assets", "WHERE id=? AND account_did=?", id, a["did"])
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return nil, e
		}
		if e != nil || !strings.HasPrefix(str(asset["mime_type"]), "image/") {
			return nil, fail(422, "A selected feedback image is unavailable")
		}
		if !feedbackCanUpload(str(a["scope"]), str(asset["mime_type"])) {
			return nil, fail(403, feedbackMissingPermission)
		}
		blob, e := s.assetBlob(ctx, a, asset)
		if e != nil {
			return nil, wrapError(e)
		}
		alt := asset["alt_text"]
		if alt == nil {
			alt = "Feedback image"
		}
		images = append(images, Row{"image": blob, "alt": alt})
	}
	createdAt := iso(now())
	record := Row{"$type": "app.userinput.discussion", "space": Row{"uri": b["uri"], "cid": b["cid"]}, "title": input.title, "createdAt": createdAt}
	if input.body != "" {
		record["body"] = input.body
	}
	if len(input.tags) > 0 {
		record["tags"] = input.tags
	}
	if len(images) > 0 {
		record["images"] = images
	}
	var discussion Row
	if e = s.rpc(ctx, a, "POST", "com.atproto.repo.createRecord", nil, Row{"repo": a["did"], "collection": "app.userinput.discussion", "record": record}, &discussion); e != nil {
		return nil, wrapError(e)
	}
	uri, cid := str(discussion["uri"]), str(discussion["cid"])
	if !owned(uri, str(a["did"]), "app.userinput.discussion") || cid == "" {
		return nil, fail(502, "The PDS returned an invalid feedback record URI")
	}
	_, _, rkey, _ := ref(uri)
	// A failed initial vote must not turn a durable discussion into a retryable failure.
	_ = s.rpc(ctx, a, "POST", "com.atproto.repo.putRecord", nil, Row{"repo": a["did"], "collection": "app.userinput.upvote", "rkey": rkey, "record": Row{"$type": "app.userinput.upvote", "subject": Row{"uri": uri, "cid": cid}, "createdAt": createdAt}}, &Row{})
	return Row{"uri": uri, "cid": cid, "url": "https://userinput.app/d/" + url.QueryEscape(str(a["did"])) + "/" + url.QueryEscape(rkey) + "?lang=en"}, nil
}
