package backend

import (
	"context"
	"errors"
	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

type RepositoryRecord struct {
	URI   string `json:"uri"`
	CID   string `json:"cid"`
	Value Row    `json:"value"`
}

func (s *Server) publicRPC(ctx context.Context, a Row, nsid string, q url.Values, out any) error {
	session := atproto.Session{DID: str(a["did"]), PDSURL: str(a["pds_url"])}
	return s.AT.XRPC(ctx, &session, "GET", nsid, q, nil, out)
}
func (s *Server) listRecords(ctx context.Context, a Row, collection string, maxPages int) ([]RepositoryRecord, error) {
	records := []RepositoryRecord{}
	cursor := ""
	seen := map[string]bool{}
	for page := 0; maxPages <= 0 || page < maxPages; page++ {
		q := url.Values{"repo": {str(a["did"])}, "collection": {collection}, "limit": {"100"}}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		var response struct {
			Records []RepositoryRecord `json:"records"`
			Cursor  string             `json:"cursor"`
		}
		if e := s.publicRPC(ctx, a, "com.atproto.repo.listRecords", q, &response); e != nil {
			return nil, e
		}
		records = append(records, response.Records...)
		if len(response.Records) == 0 || response.Cursor == "" {
			return records, nil
		}
		if seen[response.Cursor] {
			return nil, fail(502, "PDS repeated a "+collection+" listing cursor")
		}
		seen[response.Cursor] = true
		cursor = response.Cursor
	}
	return records, nil
}
func (s *Server) getRecord(ctx context.Context, a Row, collection, rkey string) (*RepositoryRecord, error) {
	var record RepositoryRecord
	e := s.publicRPC(ctx, a, "com.atproto.repo.getRecord", url.Values{"repo": {str(a["did"])}, "collection": {collection}, "rkey": {rkey}}, &record)
	var ae *atproto.Error
	if errors.As(e, &ae) && (ae.Code == "RecordNotFound" || ae.StatusCode == 404) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	return &record, nil
}
func detectHost(values ...string) string {
	for _, v := range values {
		v = strings.ToLower(v)
		switch {
		case strings.Contains(v, "leaflet"):
			return "leaflet"
		case strings.Contains(v, "markpub"):
			return "markpub"
		case strings.Contains(v, "offprint"):
			return "offprint"
		case strings.Contains(v, "pckt") || strings.Contains(v, "pocket"):
			return "pckt"
		}
	}
	return "unknown"
}
func publicationResponse(p, a Row) Row {
	r := response(p)
	delete(r, "iconCID")
	r["iconURL"] = blobURL(a, p["icon_cid"])
	return r
}
func (s *Server) publications(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	if r.URL.Query().Get("accountDID") == "" {
		return nil, fail(400, "Missing accountDID")
	}
	ps, e := s.Store.Rows(r.Context(), "publication_cache", "WHERE account_did=? ORDER BY name", a["did"])
	out := []Row{}
	for _, p := range ps {
		out = append(out, publicationResponse(p, a))
	}
	return out, e
}
func (s *Server) syncPublications(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	in, e := decode(r)
	if e != nil {
		return nil, e
	}
	if e = requireDID(a, in["accountDID"]); e != nil {
		return nil, e
	}
	ps, e := s.discover(r.Context(), a)
	if e != nil {
		return nil, wrapError(e)
	}
	out := []Row{}
	for _, p := range ps {
		out = append(out, publicationResponse(p, a))
	}
	return out, nil
}
func (s *Server) discover(ctx context.Context, a Row) ([]Row, error) {
	records, e := s.listRecords(ctx, a, "site.standard.publication", 0)
	if e != nil {
		return nil, e
	}
	byURI := map[string]Row{}
	syncedAt := now()
	for _, r := range records {
		v := r.Value
		if !owned(r.URI, str(a["did"]), "site.standard.publication") || str(v["$type"]) != "" && str(v["$type"]) != "site.standard.publication" || strings.TrimSpace(str(v["name"])) == "" || strings.TrimSpace(str(v["url"])) == "" {
			continue
		}
		_, _, rkey, _ := ref(r.URI)
		if rkey == "blento.self" {
			continue
		}
		theme := object(v["theme"])
		themeURI := str(theme["uri"])
		if themeURI == "" {
			themeURI = str(v["theme"])
		}
		byURI[r.URI] = Row{"id": uuid(), "account_did": a["did"], "uri": r.URI, "cid": nullable(r.CID), "name": strings.TrimSpace(str(v["name"])), "url": strings.TrimSpace(str(v["url"])), "description": v["description"], "icon_cid": nullable(blobCID(v["icon"])), "theme_type": theme["$type"], "theme_name": theme["name"], "host": detectHost(str(theme["$type"]), themeURI, str(theme["name"]), str(v["url"])), "synced_at": syncedAt}
	}
	// Reconcile only after the entire paginated remote read succeeded.
	tx, e := s.Store.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	for uri, p := range byURI {
		var oldID string
		if tx.QueryRowContext(ctx, "SELECT id FROM publication_cache WHERE account_did=? AND uri=?", a["did"], uri).Scan(&oldID) == nil {
			p["id"] = oldID
		}
		_, e = tx.ExecContext(ctx, `INSERT INTO publication_cache(id,account_did,uri,cid,name,url,description,icon_cid,theme_type,theme_name,host,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_did,uri) DO UPDATE SET cid=excluded.cid,name=excluded.name,url=excluded.url,description=excluded.description,icon_cid=excluded.icon_cid,theme_type=excluded.theme_type,theme_name=excluded.theme_name,host=excluded.host,synced_at=excluded.synced_at`, p["id"], a["did"], uri, p["cid"], p["name"], p["url"], p["description"], p["icon_cid"], p["theme_type"], p["theme_name"], p["host"], syncedAt)
		if e != nil {
			return nil, e
		}
	}
	rows, e := tx.QueryContext(ctx, "SELECT id,uri FROM publication_cache WHERE account_did=?", a["did"])
	if e != nil {
		return nil, e
	}
	stale := []string{}
	for rows.Next() {
		var id, uri string
		if e = rows.Scan(&id, &uri); e != nil {
			rows.Close()
			return nil, e
		}
		if byURI[uri] == nil {
			stale = append(stale, id)
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, id := range stale {
		if _, e = tx.ExecContext(ctx, "DELETE FROM publication_cache WHERE id=?", id); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	out := []Row{}
	for _, p := range byURI {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return str(out[i]["name"]) < str(out[j]["name"]) })
	return out, nil
}
