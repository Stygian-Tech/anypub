package backend

import (
	"net/http"
	"strings"
)

func draftResponse(d Row) Row {
	r := response(d)
	r["tags"] = parsed(d["tags_json"])
	delete(r, "tagsJSON")
	delete(r, "retainedDocumentURI")
	delete(r, "retainedPlatformDocumentURI")
	if r["blockSchemaVersion"] == nil {
		r["blockSchemaVersion"] = 1
	}
	if r["blockRevision"] == nil {
		r["blockRevision"] = 0
	}
	return r
}
func (s *Server) findDraft(r *http.Request) (Row, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	d, e := s.Store.One(r.Context(), "drafts", "WHERE id=? AND account_did=?", strings.ToUpper(r.PathValue("id")), a["did"])
	if e != nil {
		return nil, fail(404, "Draft not found")
	}
	return d, nil
}
func (s *Server) drafts(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	where := "WHERE account_did=?"
	args := []any{a["did"]}
	if p := r.URL.Query().Get("publicationURI"); p != "" {
		where += " AND publication_uri=?"
		args = append(args, p)
	}
	ds, e := s.Store.Rows(r.Context(), "drafts", where+" ORDER BY updated_at DESC", args...)
	out := []Row{}
	for _, d := range ds {
		out = append(out, draftResponse(d))
	}
	return out, e
}
func (s *Server) getDraft(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	return draftResponse(d), nil
}
func (s *Server) upsertDraft(r *http.Request, d Row) (Row, error) {
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
	for _, k := range []string{"accountDID", "publicationURI", "publicationURL", "title", "markdown"} {
		if _, ok := in[k].(string); !ok {
			return nil, fail(400, "Missing draft field: "+k)
		}
	}
	if !owned(str(in["publicationURI"]), str(a["did"]), "site.standard.publication") {
		return nil, fail(403, "The selected publication does not belong to this account")
	}
	if id := str(in["coverAssetID"]); id != "" {
		asset, e := s.Store.One(r.Context(), "cover_assets", "WHERE id=? AND account_did=?", strings.ToUpper(id), a["did"])
		if e != nil || asset == nil {
			return nil, fail(422, "The selected image does not belong to this account")
		}
		in["coverAssetID"] = strings.ToUpper(id)
	}
	if e = validateSnapshot(in); e != nil {
		return nil, e
	}
	if d == nil {
		d = Row{"id": uuid(), "account_did": a["did"], "status": "draft", "created_at": now(), "block_schema_version": 1, "block_revision": 0}
	}
	if d["publication_uri"] != in["publicationURI"] {
		d["retained_document_uri"] = nil
		d["retained_platform_document_uri"] = nil
	}
	fields := map[string]string{"publicationURI": "publication_uri", "publicationURL": "publication_url", "title": "title", "path": "path", "excerpt": "excerpt", "markdown": "markdown", "blockDocumentJSON": "block_document_json", "coverAssetID": "cover_asset_id"}
	for k, c := range fields {
		d[c] = in[k]
	}
	for k, c := range map[string]string{"blockSchemaVersion": "block_schema_version", "blockRevision": "block_revision"} {
		if in[k] != nil {
			d[c] = in[k]
		}
	}
	d["tags_json"] = jsonString(array(in["tags"]))
	d["plaintext"] = plainMarkdown(str(in["markdown"]))
	d["updated_at"] = now()
	return d, s.Store.Save(r.Context(), "drafts", d)
}
func (s *Server) createDraft(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.upsertDraft(r, nil)
	if e != nil {
		return nil, e
	}
	return draftResponse(d), nil
}
func (s *Server) updateDraft(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	d, e = s.upsertDraft(r, d)
	if e != nil {
		return nil, e
	}
	return draftResponse(d), nil
}
func (s *Server) changePublication(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	if d["status"] != "draft" && d["status"] != "failed" {
		return nil, fail(409, "Only drafts can change publication")
	}
	in, e := decode(r)
	if e != nil {
		return nil, e
	}
	if !owned(str(in["publicationURI"]), str(d["account_did"]), "site.standard.publication") {
		return nil, fail(403, "The selected publication does not belong to this account")
	}
	if str(in["publicationURL"]) == "" {
		return nil, fail(400, "Missing publication URL")
	}
	if d["publication_uri"] != in["publicationURI"] {
		d["retained_document_uri"] = nil
		d["retained_platform_document_uri"] = nil
	}
	d["publication_uri"] = in["publicationURI"]
	d["publication_url"] = in["publicationURL"]
	d["updated_at"] = now()
	return draftResponse(d), s.Store.Save(r.Context(), "drafts", d)
}
func (s *Server) schedule(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	in, e := decode(r)
	if e != nil {
		return nil, e
	}
	t, e := timestamp(in["scheduledAt"])
	if e != nil {
		return nil, e
	}
	d["scheduled_at"] = t
	d["status"] = "scheduled"
	d["updated_at"] = now()
	if e = s.Store.Save(r.Context(), "drafts", d); e != nil {
		return nil, e
	}
	_ = s.calendarUpsert(r.Context(), d)
	return draftResponse(d), nil
}
func (s *Server) revert(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	if d["status"] != "scheduled" {
		return nil, fail(409, "Only scheduled posts can be reverted to draft")
	}
	if e = s.calendarDelete(r.Context(), d); e != nil {
		return nil, e
	}
	d["scheduled_at"] = nil
	d["status"] = "draft"
	d["updated_at"] = now()
	return draftResponse(d), s.Store.Save(r.Context(), "drafts", d)
}
func (s *Server) publishHTTP(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	return s.Publish(r.Context(), d)
}
func (s *Server) unpublishHTTP(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	if d["status"] != "published" || str(d["document_uri"]) == "" {
		return nil, fail(409, "Only published posts can be unpublished")
	}
	if e = s.Unpublish(r.Context(), d); e != nil {
		return nil, e
	}
	return draftResponse(d), nil
}
func (s *Server) deleteDraft(w http.ResponseWriter, r *http.Request) (any, error) {
	d, e := s.findDraft(r)
	if e != nil {
		return nil, e
	}
	if str(d["document_uri"]) != "" {
		e = s.Unpublish(r.Context(), d)
	} else {
		e = s.calendarDelete(r.Context(), d)
	}
	if e != nil {
		return nil, e
	}
	return nil, s.Store.Delete(r.Context(), "drafts", str(d["id"]))
}
func (s *Server) calendar(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	ds, e := s.Store.Rows(r.Context(), "drafts", "WHERE account_did=? AND status IN ('scheduled','published') ORDER BY scheduled_at", a["did"])
	out := []Row{}
	for _, d := range ds {
		t := d["published_at"]
		if t == nil {
			t = d["scheduled_at"]
		}
		out = append(out, Row{"draftID": d["id"], "title": d["title"], "status": d["status"], "date": iso(t), "publicationURI": d["publication_uri"], "documentURI": d["document_uri"]})
	}
	return out, e
}
