package backend

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	researchCollection = "network.cosmik.collection"
	researchLink       = "network.cosmik.collectionLink"
	researchRemoval    = "network.cosmik.collectionLinkRemoval"
	researchCard       = "network.cosmik.card"
	researchNote       = "at.margin.note"
)

func researchString(v any) string       { return strings.TrimSpace(str(v)) }
func researchType(v Row, t string) bool { x, ok := v["$type"]; return !ok || x == t }
func researchOptional(v any) any {
	if s := researchString(v); s != "" {
		return s
	}
	return nil
}
func researchRef(v any) string {
	m := object(v)
	if researchString(m["cid"]) == "" {
		return ""
	}
	return researchString(m["uri"])
}
func researchValid(r RepositoryRecord, did, c string) bool {
	return owned(r.URI, did, c) && researchType(r.Value, c)
}
func researchSort(rows []Row, primary, fallback string) {
	sort.SliceStable(rows, func(i, j int) bool {
		stamp := func(r Row) time.Time {
			v := r[primary]
			if researchString(v) == "" {
				v = r[fallback]
			}
			t, _ := time.Parse(time.RFC3339Nano, str(v))
			return t
		}
		a, b := stamp(rows[i]), stamp(rows[j])
		if !a.Equal(b) {
			if a.IsZero() {
				return false
			}
			if b.IsZero() {
				return true
			}
			return a.After(b)
		}
		return str(rows[i]["uri"]) < str(rows[j]["uri"])
	})
}
func aggregateSemble(did string, records map[string][]RepositoryRecord) []Row {
	cards := map[string]Row{}
	for _, r := range records[researchCard] {
		v := r.Value
		c := object(v["content"])
		if !researchValid(r, did, researchCard) {
			continue
		}
		card := Row{"uri": r.URI, "createdAt": researchOptional(v["createdAt"])}
		switch researchString(v["type"]) {
		case "URL":
			if !researchType(c, researchCard+"#urlContent") || researchString(c["url"]) == "" {
				continue
			}
			card["url"] = researchString(c["url"])
			m := object(c["metadata"])
			for _, k := range []string{"title", "description", "siteName", "author"} {
				card[k] = researchOptional(m[k])
			}
		case "NOTE":
			if !researchType(c, researchCard+"#noteContent") || researchString(c["text"]) == "" {
				continue
			}
			card["note"] = researchString(c["text"])
			card["url"] = researchOptional(v["url"])
		default:
			continue
		}
		cards[r.URI] = card
	}
	removed := map[string]bool{}
	for _, r := range records[researchRemoval] {
		v := r.Value
		c, l := researchRef(v["collection"]), researchRef(v["removedLink"])
		if researchValid(r, did, researchRemoval) && researchString(v["removedAt"]) != "" && owned(c, did, researchCollection) && l != "" {
			removed[l] = true
		}
	}
	linked := map[string][]Row{}
	seen := map[string]map[string]bool{}
	for _, r := range records[researchLink] {
		v := r.Value
		c, card := researchRef(v["collection"]), researchRef(v["card"])
		if removed[r.URI] || !researchValid(r, did, researchLink) || researchString(v["addedBy"]) == "" || researchString(v["addedAt"]) == "" || !owned(c, did, researchCollection) || !owned(card, did, researchCard) || cards[card] == nil {
			continue
		}
		if seen[c] == nil {
			seen[c] = map[string]bool{}
		}
		if !seen[c][card] {
			seen[c][card] = true
			linked[c] = append(linked[c], cards[card])
		}
	}
	out := []Row{}
	for _, r := range records[researchCollection] {
		v := r.Value
		if !researchValid(r, did, researchCollection) || researchString(v["name"]) == "" || researchString(v["accessType"]) == "" {
			continue
		}
		items := linked[r.URI]
		if items == nil {
			items = []Row{}
		}
		researchSort(items, "createdAt", "createdAt")
		out = append(out, Row{"uri": r.URI, "name": researchString(v["name"]), "description": researchOptional(v["description"]), "accessType": researchString(v["accessType"]), "createdAt": researchOptional(v["createdAt"]), "updatedAt": researchOptional(v["updatedAt"]), "cards": items})
	}
	researchSort(out, "updatedAt", "createdAt")
	return out
}
func researchQuote(v any) any {
	if selectors, ok := v.([]any); ok {
		for _, s := range selectors {
			if q := researchQuote(s); q != nil {
				return q
			}
		}
		return nil
	}
	s := object(v)
	if q := researchOptional(s["exact"]); q != nil {
		return q
	}
	if next, ok := s["refinedBy"]; ok {
		return researchQuote(next)
	}
	return nil
}
func aggregateMargin(did string, records []RepositoryRecord) []Row {
	out := []Row{}
	for _, r := range records {
		v := r.Value
		t := object(v["target"])
		if !researchValid(r, did, researchNote) || researchString(v["motivation"]) == "" || researchString(t["source"]) == "" || researchString(v["createdAt"]) == "" {
			continue
		}
		tags := []string{}
		for _, tag := range array(v["tags"]) {
			if s, ok := tag.(string); ok {
				tags = append(tags, s)
			}
		}
		out = append(out, Row{"uri": r.URI, "motivation": researchString(v["motivation"]), "source": researchString(t["source"]), "title": researchOptional(t["title"]), "body": researchOptional(object(v["body"])["value"]), "quote": researchQuote(t["selector"]), "tags": tags, "color": researchOptional(v["color"]), "createdAt": researchString(v["createdAt"]), "modifiedAt": researchOptional(v["modifiedAt"])})
	}
	researchSort(out, "modifiedAt", "createdAt")
	return out
}
func (s *Server) loadResearch(ctx context.Context, a Row) Row {
	collections := []string{researchCollection, researchLink, researchRemoval, researchCard, researchNote}
	type result struct {
		records []RepositoryRecord
		err     error
	}
	results := make([]result, 5)
	var wg sync.WaitGroup
	for i, c := range collections {
		wg.Add(1)
		go func(i int, c string) {
			defer wg.Done()
			results[i].records, results[i].err = s.listRecords(ctx, a, c, 0)
		}(i, c)
	}
	wg.Wait()
	semble := Row{"collections": []Row{}}
	margin := Row{"annotations": []Row{}}
	records := map[string][]RepositoryRecord{}
	failed := false
	for i, c := range collections[:4] {
		records[c] = results[i].records
		failed = failed || results[i].err != nil
	}
	if failed {
		semble["error"] = "Semble research is temporarily unavailable."
	} else {
		semble["collections"] = aggregateSemble(str(a["did"]), records)
	}
	if results[4].err != nil {
		margin["error"] = "Margin research is temporarily unavailable."
	} else {
		margin["annotations"] = aggregateMargin(str(a["did"]), results[4].records)
	}
	return Row{"semble": semble, "margin": margin}
}
func (s *Server) research(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	return s.loadResearch(r.Context(), a), nil
}
