package backend

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
)

type feedbackTestTransport func(*http.Request) (*http.Response, error)

func (f feedbackTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func feedbackTestHTTP(body string, status int) *http.Client {
	return &http.Client{Transport: feedbackTestTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: http.Header{"Dpop-Nonce": {"nonce"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
}
func feedbackTestBoard() string {
	return jsonString(Row{"board": Row{"uri": feedbackBoardURI, "cid": "board-cid", "value": Row{"name": "AnyPub", "tags": []Row{{"label": "Bug", "value": "bug"}}}}})
}
func TestFeedbackPermissions(t *testing.T) {
	for _, scope := range []string{"atproto include:app.userinput.authFull", "include:app.userinput.authFull?aud=did:web:userinput.app", "repo:app.userinput.discussion?action=create", "repo?collection=app.userinput.discussion&action=create", "repo:*", "repo?collection=other&collection=app.userinput.discussion&action=update&action=create"} {
		if !feedbackCanCreate(scope) {
			t.Errorf("rejected %q", scope)
		}
	}
	for _, scope := range []string{"atproto", "include:site.standard.authFull", "repo:app.userinput.discussion?action=update", "repo?collection=other&action=create", "repo:app.userinput.discussionSuffix"} {
		if feedbackCanCreate(scope) {
			t.Errorf("accepted %q", scope)
		}
	}
	for _, scope := range []string{"blob:*/*", "blob:image/*", "blob?accept=image%2Fpng", "blob?accept=text%2Fplain&accept=image%2Fpng"} {
		if !feedbackCanUpload(scope, "image/png") {
			t.Errorf("rejected blob %q", scope)
		}
	}
	for _, scope := range []string{"atproto transition:generic", "include:app.userinput.authFull", "blob:image/jpeg", "blob:text/*"} {
		if feedbackCanUpload(scope, "image/png") {
			t.Errorf("accepted blob %q", scope)
		}
	}
}
func TestFeedbackBoardValidation(t *testing.T) {
	for _, tc := range []struct {
		body   string
		status int
		valid  bool
	}{{feedbackTestBoard(), 200, true}, {`{"board":{"uri":"other","cid":"cid","value":{"name":"AnyPub"}}}`, 200, false}, {`{"board":{"uri":"` + feedbackBoardURI + `","cid":"","value":{"name":"AnyPub"}}}`, 200, false}, {`{"board":{"uri":"` + feedbackBoardURI + `","cid":"cid","value":{"name":"AnyPub","tags":[{"label":"Bug"}]}}}`, 200, false}, {`not json`, 200, false}, {feedbackTestBoard(), 503, false}} {
		s := &Server{HTTP: feedbackTestHTTP(tc.body, tc.status)}
		b, e := s.resolveFeedbackBoard(context.Background())
		if (e == nil) != tc.valid {
			t.Fatalf("body %s: %#v %v", tc.body, b, e)
		}
	}
}
func TestFeedbackInputValidation(t *testing.T) {
	base := func() Row {
		return Row{"title": " Title ", "body": " Details ", "tags": []any{" bug "}, "assetIDs": []any{}}
	}
	valid, e := parseFeedbackInput(base())
	if e != nil || valid.title != "Title" || valid.body != "Details" || valid.tags[0] != "bug" {
		t.Fatalf("%#v %v", valid, e)
	}
	for _, change := range []Row{{"title": " "}, {"title": strings.Repeat("x", 201)}, {"body": strings.Repeat("x", 10001)}, {"tags": []any{true}}, {"assetIDs": []any{"invalid"}}, {"assetIDs": []any{"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"}}, {"assetIDs": []any{uuid(), uuid(), uuid(), uuid(), uuid()}}} {
		in := base()
		for k, v := range change {
			in[k] = v
		}
		if _, err := parseFeedbackInput(in); err == nil {
			t.Errorf("accepted %#v", change)
		}
	}
}
func feedbackTestServer(t *testing.T) (*Server, Row, *http.Request) {
	t.Helper()
	st, e := OpenStore(filepath.Join(t.TempDir(), "test.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { st.DB.Close() })
	at := atproto.New(atproto.Config{})
	key, e := atproto.NewDPoPKey()
	if e != nil {
		t.Fatal(e)
	}
	sealed := func(v string) string {
		x, e := at.Encrypt(v)
		if e != nil {
			t.Fatal(e)
		}
		return x
	}
	a := Row{"did": "did:plc:mine", "handle": "mine.example", "pds_url": "https://pds.example", "scope": "include:app.userinput.authFull blob:image/*", "access_token": sealed("access"), "refresh_token": sealed("refresh"), "dpop_key_json": sealed(key), "linked_at": now(), "updated_at": now()}
	if e = st.Save(context.Background(), "linked_accounts", a); e != nil {
		t.Fatal(e)
	}
	session := Row{"token_hash": hash("session"), "account_did": a["did"], "created_at": now(), "updated_at": now(), "expires_at": now() + 3600}
	if e = st.Save(context.Background(), "browser_sessions", session); e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest("POST", "/api/feedback", strings.NewReader(`{"title":" Feature ","body":" Details ","tags":["bug"],"assetIDs":[]}`))
	req.AddCookie(&http.Cookie{Name: "anypub_session", Value: "session"})
	return &Server{Store: st, AT: at, HTTP: feedbackTestHTTP(feedbackTestBoard(), 200)}, a, req
}
func TestFeedbackCreatesDiscussionDespiteVoteFailure(t *testing.T) {
	s, _, r := feedbackTestServer(t)
	writes := []Row{}
	s.AT.HTTPClient = &http.Client{Transport: feedbackTestTransport(func(req *http.Request) (*http.Response, error) {
		var in Row
		if e := json.NewDecoder(req.Body).Decode(&in); e != nil {
			t.Fatal(e)
		}
		writes = append(writes, in)
		status, body := 200, `{"uri":"at://did:plc:mine/app.userinput.discussion/key","cid":"discussion-cid"}`
		if strings.HasSuffix(req.URL.Path, "putRecord") {
			status = 500
			body = `{"error":"Failed"}`
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Dpop-Nonce": {"nonce"}}, Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}
	out, e := s.feedback(httptest.NewRecorder(), r)
	if e != nil {
		t.Fatal(e)
	}
	result := object(out)
	if result["url"] != "https://userinput.app/d/did%3Aplc%3Amine/key?lang=en" || len(writes) != 2 {
		t.Fatalf("result %#v writes %#v", result, writes)
	}
	discussion := object(writes[0]["record"])
	if discussion["title"] != "Feature" || object(discussion["space"])["cid"] != "board-cid" || discussion["images"] != nil {
		t.Fatalf("discussion %#v", discussion)
	}
	vote := object(writes[1]["record"])
	if writes[1]["rkey"] != "key" || object(vote["subject"])["cid"] != "discussion-cid" || vote["createdAt"] != discussion["createdAt"] {
		t.Fatalf("vote %#v", writes[1])
	}
}
func TestFeedbackRejectsForeignAssetsAndUnknownTags(t *testing.T) {
	s, a, _ := feedbackTestServer(t)
	for _, input := range []feedbackInput{{title: "Title", tags: []string{"unknown"}}, {title: "Title", tags: []string{"bug", "bug"}}, {title: "Title", assets: []string{uuid()}}} {
		if _, e := s.createFeedback(context.Background(), a, input); e == nil {
			t.Fatalf("accepted %#v", input)
		}
	}
}
func TestFeedbackAndResearchRequireSession(t *testing.T) {
	s, _, _ := feedbackTestServer(t)
	for _, endpoint := range []endpoint{s.feedback, s.feedbackBoard, s.research} {
		_, e := endpoint(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/research", nil))
		ae, ok := e.(*apiError)
		if !ok || ae.Status != 401 {
			t.Fatalf("expected 401: %v", e)
		}
	}
}

func TestFeedbackOwnedImagesUploadAndPermissions(t *testing.T) {
	s, a, _ := feedbackTestServer(t)
	path := filepath.Join(t.TempDir(), "image.png")
	if e := os.WriteFile(path, []byte("image bytes"), 0600); e != nil {
		t.Fatal(e)
	}
	asset := Row{"account_did": a["did"], "source": "device", "file_path": path, "mime_type": "image/png", "byte_size": 11, "created_at": now()}
	if e := s.Store.Save(context.Background(), "cover_assets", asset); e != nil {
		t.Fatal(e)
	}
	uploads := 0
	var discussion Row
	s.AT.HTTPClient = &http.Client{Transport: feedbackTestTransport(func(req *http.Request) (*http.Response, error) {
		body := `{"uri":"at://did:plc:mine/app.userinput.discussion/key","cid":"discussion-cid"}`
		if strings.HasSuffix(req.URL.Path, "uploadBlob") {
			uploads++
			data, _ := io.ReadAll(req.Body)
			if string(data) != "image bytes" || req.Header.Get("Content-Type") != "image/png" {
				t.Errorf("upload %q %s", data, req.Header.Get("Content-Type"))
			}
			body = `{"blob":{"$type":"blob","ref":{"$link":"image-cid"},"mimeType":"image/png","size":11}}`
		} else {
			var input Row
			_ = json.NewDecoder(req.Body).Decode(&input)
			if input["collection"] == "app.userinput.discussion" {
				discussion = object(input["record"])
			}
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Dpop-Nonce": {"nonce"}}, Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}
	input := feedbackInput{title: "Image", assets: []string{str(asset["id"])}}
	if _, e := s.createFeedback(context.Background(), a, input); e != nil {
		t.Fatal(e)
	}
	images := array(discussion["images"])
	if uploads != 1 || len(images) != 1 || object(images[0])["alt"] != "Feedback image" || blobCID(object(images[0])["image"]) != "image-cid" {
		t.Fatalf("images %#v uploads %d", images, uploads)
	}
	if _, e := s.createFeedback(context.Background(), a, input); e != nil {
		t.Fatal(e)
	}
	if uploads != 1 {
		t.Fatal("cached blob was uploaded again")
	}
	a["scope"] = "include:app.userinput.authFull"
	if _, e := s.createFeedback(context.Background(), a, input); e == nil {
		t.Fatal("image accepted without blob scope")
	}
	asset["account_did"] = "did:plc:other"
	if e := s.Store.Save(context.Background(), "cover_assets", asset); e != nil {
		t.Fatal(e)
	}
	a["scope"] = "include:app.userinput.authFull blob:*/*"
	if _, e := s.createFeedback(context.Background(), a, input); e == nil {
		t.Fatal("foreign image accepted")
	}
}
