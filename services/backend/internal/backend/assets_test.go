package backend

import (
	"bytes"
	"github.com/stygian-tech/anypub-kit/xrpc"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
)

func TestMultipartImageValidation(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	for _, tc := range []struct {
		name, mime, width string
		size, want        int
	}{{"PNG", "image/png", "640", 32, 200}, {"JPEG", "image/jpeg", "", 32, 200}, {"GIF", "image/gif", "", 32, 200}, {"WebP", "image/webp", "", 32, 200}, {"oversize", "image/png", "", 1000001, 413}, {"zero width", "image/png", "0", 32, 422}, {"negative width", "image/png", "-1", 32, 422}, {"bad width", "image/png", "no", 32, 422}, {"unsupported", "image/svg+xml", "", 32, 415}} {
		t.Run(tc.name, func(t *testing.T) {
			var b bytes.Buffer
			mw := multipart.NewWriter(&b)
			_ = mw.WriteField("accountDID", str(a["did"]))
			if tc.width != "" {
				_ = mw.WriteField("width", tc.width)
			}
			h := textproto.MIMEHeader{}
			h.Set("Content-Disposition", `form-data; name="file"; filename="image"`)
			h.Set("Content-Type", tc.mime)
			part, e := mw.CreatePart(h)
			if e != nil {
				t.Fatal(e)
			}
			_, _ = part.Write(bytes.Repeat([]byte("a"), tc.size))
			mw.Close()
			r := httptest.NewRequest("POST", "/api/assets/upload", &b)
			r.Header.Set("Content-Type", mw.FormDataContentType())
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if tc.want == 200 {
				out := resultForTest(t, w)
				if out["source"] != "device" || out["mimeType"] != tc.mime || out["byteSize"] != float64(tc.size) {
					t.Fatal(out)
				}
			}
		})
	}
}
func TestUnsplashIntegrationAndAttribution(t *testing.T) {
	s := appForTest(t)
	s.Config.UnsplashKey = "test-key"
	a := accountForTest(t, s, "did:plc:writer")
	cookie := cookieForTest(t, s, a)
	tracked := false
	s.HTTP = &http.Client{Transport: backendRoundTripper(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Host {
		case "api.unsplash.com":
			if r.Header.Get("Authorization") != "Client-ID test-key" || r.Header.Get("Accept-Version") != "v1" {
				t.Error("missing Unsplash API headers")
			}
			if strings.Contains(r.URL.Path, "/download") {
				tracked = true
				return wireForTest(200, Row{"url": "https://images.unsplash.com/image"}), nil
			}
			if r.URL.Query().Get("page") != "1" || r.URL.Query().Get("per_page") != "18" || r.URL.Query().Get("content_filter") != "high" {
				t.Error("search contract changed")
			}
			return wireForTest(200, Row{"total": 1, "total_pages": 1, "results": []any{Row{"id": "photo"}}}), nil
		case "images.unsplash.com":
			if r.Header.Get("Authorization") != "" {
				t.Error("Unsplash API credential leaked to image CDN")
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"image/jpeg"}}, Body: io.NopCloser(strings.NewReader("JPEG"))}, nil
		}
		t.Fatalf("unexpected host %s", r.URL.Host)
		return nil, nil
	})}
	w := requestForTest(t, s, "GET", "/api/unsplash/search?q=clouds&page=-2", nil, cookie)
	if w.Code != 200 || resultForTest(t, w)["total"] != float64(1) {
		t.Fatal(w.Body.String())
	}
	in := Row{"accountDID": a["did"], "photoID": "photo", "imageURL": "https://images.unsplash.com/image", "downloadLocation": "https://api.unsplash.com/photos/photo/download", "photographerName": "Photographer", "photographerUsername": "photo-user", "photographerURL": "https://unsplash.com/@photo-user", "unsplashURL": "https://unsplash.com/photos/photo", "altText": "Clouds"}
	w = requestForTest(t, s, "POST", "/api/unsplash/select", in, cookie)
	if w.Code != 200 || !tracked {
		t.Fatalf("select %d %s tracked=%v", w.Code, w.Body, tracked)
	}
	asset := resultForTest(t, w)
	attribution := object(parsedString(str(asset["attributionJSON"])))
	if asset["source"] != "unsplash" || attribution["photographerName"] != "Photographer" || asset["altText"] != "Clouds" {
		t.Fatal(asset)
	}
	in["downloadLocation"] = "https://attacker.example/download"
	if requestForTest(t, s, "POST", "/api/unsplash/select", in, cookie).Code != 422 {
		t.Fatal("arbitrary API credential destination accepted")
	}
	s.Config.UnsplashKey = ""
	if requestForTest(t, s, "GET", "/api/unsplash/search?q=x", nil, cookie).Code != 503 {
		t.Fatal("missing Unsplash key should be unavailable")
	}
}
func TestPurePreparationEndpoint(t *testing.T) {
	s := appForTest(t)
	s.Mount("/xrpc/"+xrpc.NSID, xrpc.Handler())
	w := requestForTest(t, s, "POST", "/xrpc/"+xrpc.NSID, Row{"operation": "document", "input": Row{"site": "at://did:plc:writer/site.standard.publication/pub", "title": "Pure", "publishedAt": "2026-01-02T03:04:05Z"}}, nil)
	if w.Code != 200 || object(resultForTest(t, w)["record"])["title"] != "Pure" {
		t.Fatalf("public preparation: %d %s", w.Code, w.Body)
	}
	var accounts int
	_ = s.Store.DB.QueryRow("SELECT count(*) FROM linked_accounts").Scan(&accounts)
	if accounts != 0 {
		t.Fatal("pure preparation persisted identity")
	}
	r := httptest.NewRequest("POST", "/xrpc/"+xrpc.NSID, strings.NewReader(`{"operation":"document","input":{"title":"`+strings.Repeat("x", (8<<20)+1)+`"}}`))
	r.Header.Set("Content-Type", "application/json")
	out := httptest.NewRecorder()
	s.ServeHTTP(out, r)
	if out.Code != 413 {
		t.Fatalf("unbounded preparation request: %d %s", out.Code, out.Body)
	}
}
