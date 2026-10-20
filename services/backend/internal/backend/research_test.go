package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
)

func researchTestRecord(did, c, key string, v Row) RepositoryRecord {
	return RepositoryRecord{URI: "at://" + did + "/" + c + "/" + key, CID: "cid", Value: v}
}
func researchTestRef(uri string) Row { return Row{"uri": uri, "cid": "cid"} }
func TestResearchSembleAggregation(t *testing.T) {
	did := "did:plc:mine"
	collection := researchTestRecord(did, researchCollection, "ideas", Row{"name": " Ideas ", "accessType": "CLOSED", "createdAt": "2026-08-01T00:00:00Z"})
	card := researchTestRecord(did, researchCard, "note", Row{"type": "NOTE", "content": Row{"text": " A note "}, "createdAt": "2026-08-04T00:00:00Z"})
	urlCard := researchTestRecord(did, researchCard, "url", Row{"type": "URL", "content": Row{"url": "https://example.com", "metadata": Row{"title": "Article"}}, "createdAt": "2026-08-03T00:00:00Z"})
	link := func(key, uri string) RepositoryRecord {
		return researchTestRecord(did, researchLink, key, Row{"collection": researchTestRef(collection.URI), "card": researchTestRef(uri), "addedBy": did, "addedAt": "now"})
	}
	removed := link("removed", urlCard.URI)
	records := map[string][]RepositoryRecord{researchCollection: {collection, researchTestRecord("did:plc:other", researchCollection, "other", collection.Value), researchTestRecord(did, researchCollection, "bad", Row{"name": "bad"})}, researchCard: {card, urlCard, researchTestRecord(did, researchCard, "bad", Row{"$type": "wrong", "type": "NOTE", "content": Row{"text": "bad"}})}, researchLink: {link("one", card.URI), link("duplicate", card.URI), removed}, researchRemoval: {researchTestRecord(did, researchRemoval, "removal", Row{"collection": researchTestRef(collection.URI), "removedLink": researchTestRef(removed.URI), "removedAt": "now"})}}
	out := aggregateSemble(did, records)
	if len(out) != 1 || out[0]["name"] != "Ideas" {
		t.Fatalf("collections: %#v", out)
	}
	cards := out[0]["cards"].([]Row)
	if len(cards) != 1 || cards[0]["note"] != "A note" {
		t.Fatalf("cards: %#v", cards)
	}
	// A malformed or foreign removal cannot suppress an owned link.
	records[researchRemoval][0].URI = "at://did:plc:other/" + researchRemoval + "/removal"
	out = aggregateSemble(did, records)
	cards = out[0]["cards"].([]Row)
	if len(cards) != 2 || cards[0]["uri"] != card.URI || cards[1]["title"] != "Article" {
		t.Fatalf("cards: %#v", cards)
	}
}
func TestResearchMarginSelectorsAndOrdering(t *testing.T) {
	did := "did:plc:mine"
	value := Row{"motivation": "highlighting", "target": Row{"source": "https://example.com", "selector": []any{Row{"exact": " "}, Row{"refinedBy": []any{Row{"exact": " passage "}}}}}, "body": Row{"value": " note "}, "tags": []any{"draft", true, " research "}, "createdAt": "2026-08-01T00:00:00Z", "modifiedAt": "2026-08-01T01:00:00+01:00"}
	a := researchTestRecord(did, researchNote, "a", value)
	b := researchTestRecord(did, researchNote, "b", Row{"motivation": "bookmarking", "target": Row{"source": "https://other.example"}, "createdAt": "2026-08-01T00:00:00.001Z"})
	out := aggregateMargin(did, []RepositoryRecord{a, b, researchTestRecord("did:plc:other", researchNote, "foreign", value), researchTestRecord(did, researchNote, "bad", Row{})})
	if len(out) != 2 || out[0]["uri"] != b.URI || out[1]["quote"] != "passage" || out[1]["body"] != "note" {
		t.Fatalf("annotations: %#v", out)
	}
	if tags := out[1]["tags"].([]string); len(tags) != 2 || tags[1] != " research " {
		t.Fatalf("tags: %#v", tags)
	}
}
func TestResearchIndependentFailuresAndPagination(t *testing.T) {
	for _, failed := range []string{researchCollection, researchNote, ""} {
		t.Run(failed, func(t *testing.T) {
			did := "did:plc:mine"
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				c := r.URL.Query().Get("collection")
				if !strings.HasPrefix(c, "network.cosmik.") && c != researchNote {
					t.Errorf("unexpected collection %s", c)
				}
				if c == failed {
					http.Error(w, "failure", 502)
					return
				}
				if c == researchNote {
					key := "first"
					cursor := "second"
					if r.URL.Query().Get("cursor") != "" {
						key = "second"
						cursor = ""
					}
					_ = json.NewEncoder(w).Encode(Row{"records": []RepositoryRecord{researchTestRecord(did, c, key, Row{"motivation": "bookmarking", "target": Row{"source": "https://example.com"}, "createdAt": "2026-08-01T00:00:00Z"})}, "cursor": cursor})
					return
				}
				_ = json.NewEncoder(w).Encode(Row{"records": []any{}})
			}))
			defer upstream.Close()
			s := &Server{AT: atproto.New(atproto.Config{})}
			s.AT.HTTPClient = upstream.Client()
			result := s.loadResearch(context.Background(), Row{"did": did, "pds_url": upstream.URL})
			semble, margin := object(result["semble"]), object(result["margin"])
			if (semble["error"] != nil) != (failed == researchCollection) || (margin["error"] != nil) != (failed == researchNote) {
				t.Fatalf("result %#v", result)
			}
			if failed != researchNote && len(margin["annotations"].([]Row)) != 2 {
				t.Fatalf("pagination: %#v", margin)
			}
		})
	}
}
func TestResearchCursorCycle(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(Row{"records": []RepositoryRecord{researchTestRecord("did:plc:mine", researchNote, "one", Row{})}, "cursor": "repeat"})
	}))
	defer upstream.Close()
	s := &Server{AT: atproto.New(atproto.Config{})}
	s.AT.HTTPClient = upstream.Client()
	if _, err := s.listRecords(context.Background(), Row{"did": "did:plc:mine", "pds_url": upstream.URL}, researchNote, 0); err == nil {
		t.Fatal("accepted cursor cycle")
	}
}
