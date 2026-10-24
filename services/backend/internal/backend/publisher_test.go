package backend

import (
	"context"
	"encoding/json"
	anypub "github.com/stygian-tech/anypub-kit"
	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type mockPDS struct {
	mu                                     sync.Mutex
	records                                map[string]Row
	writes                                 []Row
	requests                               int
	swapFailure, badResults, verifyFailure bool
	blobs                                  int
}

func attachPDS(t *testing.T, s *Server, a Row) *mockPDS {
	t.Helper()
	p := &mockPDS{records: map[string]Row{}}
	pubURI := "at://" + str(a["did"]) + "/site.standard.publication/pub"
	p.records["site.standard.publication/pub"] = Row{"$type": "site.standard.publication", "name": "Publication", "url": "https://publication.example"}
	p.records["blog.pckt.publication/pub"] = Row{"$type": "blog.pckt.publication", "publication": Row{"uri": pubURI, "cid": "standard-cid"}}
	client := &http.Client{Transport: backendRoundTripper(func(r *http.Request) (*http.Response, error) {
		p.mu.Lock()
		defer p.mu.Unlock()
		p.requests++
		if r.URL.Host == "publication.example" {
			value := pubURI
			if p.verifyFailure {
				value = "wrong"
			}
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(value))}, nil
		}
		nsid := strings.TrimPrefix(r.URL.Path, "/xrpc/")
		switch nsid {
		case "com.atproto.repo.getRecord":
			key := r.URL.Query().Get("collection") + "/" + r.URL.Query().Get("rkey")
			record := p.records[key]
			if record == nil {
				return wireForTest(400, Row{"error": "RecordNotFound"}), nil
			}
			cid := "standard-cid"
			if key != "site.standard.publication/pub" {
				cid, _ = atproto.RecordCID(record)
			}
			return wireForTest(200, Row{"uri": "at://" + str(a["did"]) + "/" + key, "cid": cid, "value": record}), nil
		case "com.atproto.sync.getLatestCommit":
			return wireForTest(200, Row{"cid": "head-cid"}), nil
		case "com.atproto.repo.listRecords":
			collection := r.URL.Query().Get("collection")
			records := []any{}
			for key, v := range p.records {
				if strings.HasPrefix(key, collection+"/") {
					records = append(records, Row{"uri": "at://" + str(a["did"]) + "/" + key, "cid": "record-cid", "value": v})
				}
			}
			return wireForTest(200, Row{"records": records}), nil
		case "com.atproto.repo.uploadBlob":
			p.blobs++
			payload, _ := io.ReadAll(r.Body)
			return wireForTest(200, Row{"blob": Row{"$type": "blob", "ref": Row{"$link": "bafkreiahuldz3oqngpfq6nyueb252o6lkhqptwjn7mqumzfykpjqhzvmci"}, "mimeType": r.Header.Get("Content-Type"), "size": len(payload)}}), nil
		case "com.atproto.sync.getBlob":
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"image/png"}}, Body: io.NopCloser(strings.NewReader("image-data"))}, nil
		}
		var in Row
		decoder := json.NewDecoder(r.Body)
		decoder.UseNumber()
		if e := decoder.Decode(&in); e != nil {
			t.Errorf("invalid body: %v", e)
		}
		if r.Header.Get("Authorization") != "DPoP access" || r.Header.Get("DPoP") == "" {
			t.Error("write did not use owned OAuth DPoP credentials")
		}
		p.writes = append(p.writes, Row{"method": nsid, "input": in})
		switch nsid {
		case "com.atproto.repo.applyWrites":
			if in["swapCommit"] != "head-cid" {
				t.Error("missing repository-head guard")
			}
			if p.swapFailure {
				return wireForTest(400, Row{"error": "InvalidSwap"}), nil
			}
			results := []any{}
			for _, entry := range array(in["writes"]) {
				w := object(entry)
				key := str(w["collection"]) + "/" + str(w["rkey"])
				if strings.HasSuffix(str(w["$type"]), "#delete") {
					delete(p.records, key)
					continue
				}
				v := object(w["value"])
				p.records[key] = v
				cid, e := atproto.RecordCID(v)
				if e != nil {
					t.Error(e)
				}
				results = append(results, Row{"uri": "at://" + str(a["did"]) + "/" + key, "cid": cid})
			}
			if p.badResults {
				results = []any{}
			}
			return wireForTest(200, Row{"results": results}), nil
		case "com.atproto.repo.createRecord", "com.atproto.repo.putRecord":
			key := str(in["rkey"])
			if key == "" {
				key = "generated"
			}
			collection := str(in["collection"])
			p.records[collection+"/"+key] = object(in["record"])
			cid, _ := atproto.RecordCID(in["record"])
			return wireForTest(200, Row{"uri": "at://" + str(a["did"]) + "/" + collection + "/" + key, "cid": cid}), nil
		case "com.atproto.repo.deleteRecord":
			delete(p.records, str(in["collection"])+"/"+str(in["rkey"]))
			return wireForTest(200, Row{}), nil
		}
		return wireForTest(500, Row{"error": "UnexpectedMethod"}), nil
	})}
	s.AT.HTTPClient = client
	s.HTTP = client
	return p
}
func TestPublishAllHostsAndUnpublishRepublish(t *testing.T) {
	for _, host := range []string{"leaflet", "offprint", "pckt", "markpub", "unknown"} {
		t.Run(host, func(t *testing.T) {
			s := appForTest(t)
			a := accountForTest(t, s, "did:plc:writer")
			d := draftForTest(t, s, a, host)
			p := attachPDS(t, s, a)
			result, e := s.Publish(context.Background(), d)
			if e != nil {
				t.Fatal(e)
			}
			if str(result["documentURI"]) == "" || str(result["documentCID"]) == "" {
				t.Fatal(result)
			}
			published, e := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
			if e != nil || published["status"] != "published" {
				t.Fatalf("%v %v", published, e)
			}
			if host == "pckt" || host == "offprint" {
				if str(result["platformDocumentURI"]) == "" || p.writes[0]["method"] != "com.atproto.repo.applyWrites" {
					t.Fatal("native writes not atomic")
				}
				docKey := recordKey(str(result["documentURI"]))
				collection := "blog.pckt.document"
				if host == "offprint" {
					collection = "app.offprint.document.article"
				}
				wrapper := p.records[collection+"/"+recordKey(str(result["platformDocumentURI"]))]
				if object(wrapper["document"])["cid"] != result["documentCID"] {
					t.Fatal("wrapper did not use canonical DAG-CBOR CID")
				}
				if host == "pckt" && docKey != recordKey(str(result["platformDocumentURI"])) {
					t.Fatal("pckt record keys differ")
				}
			}
			original := published["document_uri"]
			native := published["platform_document_uri"]
			if e = s.Unpublish(context.Background(), published); e != nil {
				t.Fatal(e)
			}
			saved, _ := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
			if saved["status"] != "draft" || saved["document_uri"] != nil || saved["retained_document_uri"] != original || saved["retained_platform_document_uri"] != native {
				t.Fatal(saved)
			}
			again, e := s.Publish(context.Background(), saved)
			if e != nil {
				t.Fatal(e)
			}
			if again["documentURI"] != original || again["platformDocumentURI"] != native {
				t.Fatalf("identity changed on republish: %v", again)
			}
		})
	}
}
func TestPublishValidationBeforeLifecycleMutation(t *testing.T) {
	for _, field := range []string{"title", "excerpt", "tags_json"} {
		t.Run(field, func(t *testing.T) {
			s := appForTest(t)
			a := accountForTest(t, s, "did:plc:writer")
			d := draftForTest(t, s, a, "pckt")
			d["status"] = "published"
			d["document_uri"] = "at://did:plc:writer/site.standard.document/existing"
			switch field {
			case "title":
				d[field] = strings.Repeat("x", 2000)
			case "excerpt":
				d[field] = strings.Repeat("x", 10000)
			case "tags_json":
				d[field] = jsonString([]any{strings.Repeat("x", 1000)})
			}
			saveForTest(t, s, "drafts", d)
			p := attachPDS(t, s, a)
			if _, e := s.Publish(context.Background(), d); e == nil {
				t.Fatal("invalid metadata published")
			}
			saved, _ := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
			if saved["status"] != "published" || saved["updated_at"] != d["updated_at"] || p.requests != 0 {
				t.Fatalf("invalid metadata mutated state or reached network: %v requests=%d", saved, p.requests)
			}
		})
	}
}
func TestAtomicCommitGuardFailureAndResultValidation(t *testing.T) {
	for _, host := range []string{"pckt", "offprint"} {
		for _, mode := range []string{"swap", "results"} {
			t.Run(host+mode, func(t *testing.T) {
				s := appForTest(t)
				a := accountForTest(t, s, "did:plc:writer")
				d := draftForTest(t, s, a, host)
				p := attachPDS(t, s, a)
				p.swapFailure = mode == "swap"
				p.badResults = mode == "results"
				if _, e := s.Publish(context.Background(), d); e == nil {
					t.Fatal("invalid atomic response succeeded")
				}
				saved, _ := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
				if saved["status"] != "failed" || saved["document_uri"] != nil {
					t.Fatal(saved)
				}
				attempts, _ := s.Store.Rows(context.Background(), "publish_attempts", "WHERE draft_id=?", d["id"])
				if len(attempts) != 1 || attempts[0]["status"] != "failed" {
					t.Fatal(attempts)
				}
			})
		}
	}
}
func TestPcktVerificationFailsBeforePublishState(t *testing.T) {
	for _, mode := range []string{"missing-native", "stale-cid", "wrong-verification", "http-url"} {
		t.Run(mode, func(t *testing.T) {
			s := appForTest(t)
			a := accountForTest(t, s, "did:plc:writer")
			d := draftForTest(t, s, a, "pckt")
			p := attachPDS(t, s, a)
			switch mode {
			case "missing-native":
				delete(p.records, "blog.pckt.publication/pub")
			case "stale-cid":
				p.records["blog.pckt.publication/pub"]["publication"] = Row{"uri": d["publication_uri"], "cid": "old"}
			case "wrong-verification":
				p.verifyFailure = true
			case "http-url":
				p.records["site.standard.publication/pub"]["url"] = "http://publication.example"
			}
			if _, e := s.Publish(context.Background(), d); e == nil {
				t.Fatal("unverified pckt publication accepted")
			}
			saved, _ := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
			if saved["status"] != "draft" || len(p.writes) != 0 {
				t.Fatal("verification mutated lifecycle")
			}
		})
	}
}
func TestBodyImagesCoverOffloadAndCache(t *testing.T) {
	for _, host := range []string{"leaflet", "pckt", "markpub"} {
		t.Run(host, func(t *testing.T) {
			s := appForTest(t)
			a := accountForTest(t, s, "did:plc:writer")
			d := draftForTest(t, s, a, host)
			asset, e := s.storeAsset(context.Background(), a, []byte("PNG"), "image/png", "device", "Cover", 640, 480, nil, nil)
			if e != nil {
				t.Fatal(e)
			}
			d["cover_asset_id"] = asset["id"]
			d["markdown"] = strings.Repeat("a", 220000) + "\n\n![Body](anypub-asset://" + str(asset["id"]) + ")"
			saveForTest(t, s, "drafts", d)
			p := attachPDS(t, s, a)
			if _, e = s.Publish(context.Background(), d); e != nil {
				t.Fatal(e)
			}
			if p.blobs != 2 {
				t.Fatalf("expected body/cover reused blob and one offload, got %d", p.blobs)
			}
			saved, _ := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
			if _, e = s.Publish(context.Background(), saved); e != nil {
				t.Fatal(e)
			}
			if p.blobs != 3 {
				t.Fatalf("asset cache not reused, uploads %d", p.blobs)
			}
		})
	}
}
func TestSchedulerAndBackfill(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	d := draftForTest(t, s, a, "offprint")
	d["status"] = "scheduled"
	d["scheduled_at"] = now() - 10
	saveForTest(t, s, "drafts", d)
	p := attachPDS(t, s, a)
	if e := s.RunScheduled(context.Background()); e != nil {
		t.Fatal(e)
	}
	saved, _ := s.Store.One(context.Background(), "drafts", "WHERE id=?", d["id"])
	if saved["status"] != "published" {
		t.Fatal(saved)
	}
	runs, _ := s.Store.Rows(context.Background(), "scheduler_runs", "")
	if len(runs) != 1 || num(runs[0]["published_count"]) != 1 {
		t.Fatal(runs)
	}
	native, e := anypub.BuildArticleNativeContent(anypub.NativeContentInput{Host: "offprint", Markdown: "# Imported\n\nBody", Blocks: markdownBlocks("# Imported\n\nBody", "")})
	if e != nil {
		t.Fatal(e)
	}
	p.records["site.standard.document/remote"] = Row{"$type": "site.standard.document", "site": d["publication_uri"], "title": "Imported", "publishedAt": "2026-01-02T03:04:05Z", "content": native.Content}
	p.records["app.offprint.document.article/remote-wrapper"] = Row{"document": Row{"uri": "at://did:plc:writer/site.standard.document/remote", "cid": "ref"}}
	cookie := cookieForTest(t, s, a)
	w := requestForTest(t, s, "POST", "/api/drafts/backfill", Row{"accountDID": a["did"]}, cookie)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var imported []Row
	_ = json.Unmarshal(w.Body.Bytes(), &imported)
	if len(imported) != 1 || imported[0]["markdown"] != "# Imported\n\nBody" || imported[0]["platformDocumentURI"] != "at://did:plc:writer/app.offprint.document.article/remote-wrapper" {
		t.Fatalf("%s", w.Body)
	}
	w = requestForTest(t, s, "POST", "/api/drafts/backfill", Row{"accountDID": a["did"]}, cookie)
	if w.Code != 200 || w.Body.String() != "[]\n" {
		t.Fatalf("duplicate backfill: %d %s", w.Code, w.Body)
	}
}
func TestDiscoveryReconcileAndCursorFailure(t *testing.T) {
	s := appForTest(t)
	a := accountForTest(t, s, "did:plc:writer")
	d := draftForTest(t, s, a, "markpub")
	_ = d
	attachPDS(t, s, a)
	out, e := s.discover(context.Background(), a)
	if e != nil || len(out) != 1 {
		t.Fatalf("%v %v", out, e)
	}
	s.AT.HTTPClient = &http.Client{Transport: backendRoundTripper(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("DPoP") != "" {
			t.Error("public discovery included credentials")
		}
		return wireForTest(200, Row{"cursor": "repeated", "records": []any{Row{"uri": "at://did:plc:writer/site.standard.publication/new", "value": Row{"name": "New", "url": "https://new.example"}}}}), nil
	})}
	if _, e = s.discover(context.Background(), a); e == nil {
		t.Fatal("repeated cursor accepted")
	}
	rows, _ := s.Store.Rows(context.Background(), "publication_cache", "WHERE account_did=?", a["did"])
	if len(rows) != 1 || rows[0]["uri"] != out[0]["uri"] {
		t.Fatal("failed discovery replaced good cache")
	}
}

func TestMarkpubRemoteImagesRemainRemoteMarkdown(t *testing.T) {
	for _, host := range []string{"markpub", "unknown"} {
		t.Run(host, func(t *testing.T) {
			s := appForTest(t)
			a := accountForTest(t, s, "did:plc:writer")
			d := draftForTest(t, s, a, host)
			md := "# Remote image\n\n![Remote alt](https://images.example/photo.png)"
			d["markdown"] = md
			saveForTest(t, s, "drafts", d)
			p := attachPDS(t, s, a)
			if _, e := s.Publish(context.Background(), d); e != nil {
				t.Fatal(e)
			}
			if p.blobs != 0 {
				t.Fatal("remote Markdown image caused blob upload")
			}
			published := p.records["site.standard.document/generated"]
			if object(object(published["content"])["text"])["markdown"] != md {
				t.Fatalf("remote image removed: %#v", published)
			}
			var assets int
			_ = s.Store.DB.QueryRow("SELECT count(*) FROM cover_assets").Scan(&assets)
			if assets != 0 {
				t.Fatal("remote image caused local asset mutation")
			}
		})
	}
}
