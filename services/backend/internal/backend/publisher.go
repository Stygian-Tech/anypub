package backend

import (
	"context"
	"database/sql"
	"fmt"
	anypub "github.com/stygian-tech/anypub-kit"
	"github.com/stygian-tech/anypub/services/backend/internal/atproto"
	"net/url"
	"regexp"
	"strings"
	"time"
)

func (s *Server) writeRecord(ctx context.Context, a Row, collection, rkey string, record Row) (Row, error) {
	method := "com.atproto.repo.createRecord"
	in := Row{"repo": a["did"], "collection": collection, "record": record}
	if rkey != "" {
		method = "com.atproto.repo.putRecord"
		in["rkey"] = rkey
	}
	var out Row
	if e := s.rpc(ctx, a, "POST", method, nil, in, &out); e != nil {
		return nil, e
	}
	if !owned(str(out["uri"]), str(a["did"]), collection) || str(out["cid"]) == "" {
		return nil, fail(502, "PDS returned an invalid record reference")
	}
	if rkey != "" {
		_, _, got, _ := ref(str(out["uri"]))
		if got != rkey {
			return nil, fail(502, "PDS returned a different record key")
		}
	}
	return out, nil
}
func (s *Server) deleteRecord(ctx context.Context, a Row, uri string) error {
	did, collection, rkey, e := ref(uri)
	if e != nil {
		return e
	}
	if did != str(a["did"]) {
		return fail(403, "Record belongs to another account")
	}
	var out Row
	return s.rpc(ctx, a, "POST", "com.atproto.repo.deleteRecord", nil, Row{"repo": did, "collection": collection, "rkey": rkey}, &out)
}
func (s *Server) head(ctx context.Context, a Row) (string, error) {
	var out Row
	e := s.publicRPC(ctx, a, "com.atproto.sync.getLatestCommit", url.Values{"did": {str(a["did"])}}, &out)
	if e != nil {
		return "", e
	}
	if str(out["cid"]) == "" {
		return "", fail(502, "PDS returned no repository head")
	}
	return str(out["cid"]), nil
}
func documentInput(d Row, cover, content Row, text string, pckt bool) Row {
	published := d["published_at"]
	if published == nil {
		published = d["scheduled_at"]
	}
	if published == nil {
		published = now()
	}
	in := Row{"site": d["publication_uri"], "title": d["title"], "publishedAt": iso(published), "textContent": text, "updatedAt": iso(now())}
	for k, v := range map[string]any{"path": d["path"], "description": d["excerpt"], "coverImage": cover, "content": content} {
		if v != nil {
			in[k] = v
		}
	}
	tags := array(parsed(d["tags_json"]))
	if len(tags) > 0 || pckt {
		in["tags"] = tags
	}
	if pckt {
		in["langs"] = []any{"en"}
	}
	return in
}
func recordKey(uri string) string { _, _, key, _ := ref(uri); return key }
func publishingURI(d Row, field string) string {
	if str(d[field]) != "" {
		return str(d[field])
	}
	return str(d["retained_"+field])
}

var slugRE = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	return strings.Trim(slugRE.ReplaceAllString(strings.ToLower(s), "-"), "-")
}
func pcktPath(d Row, update bool) string {
	current := strings.TrimSpace(str(d["path"]))
	if update && current != "" {
		return "/" + strings.TrimPrefix(current, "/")
	}
	source := strings.Trim(current, "/")
	id := strings.ToLower(strings.ReplaceAll(str(d["id"]), "-", ""))
	if len(id) > 7 {
		id = id[len(id)-7:]
	}
	if strings.HasSuffix(source, "-"+id) {
		return "/" + strings.TrimPrefix(current, "/")
	}
	if source == "" {
		source = slug(str(d["title"]))
	}
	if source == "" {
		source = "untitled-article"
	}
	return "/" + source + "-" + id
}
func offprintPath(d Row, key string) string {
	current := strings.TrimSpace(str(d["path"]))
	prefix := "/a/" + key + "-"
	if strings.HasPrefix(current, prefix) && len(current) > len(prefix) {
		return current
	}
	source := strings.Trim(current, "/")
	if strings.HasPrefix(source, "a/") {
		source = strings.TrimPrefix(source, "a/")
		if i := strings.Index(source, "-"); i >= 0 {
			source = source[i+1:]
		}
	}
	source = slug(source)
	if source == "" {
		source = slug(str(d["title"]))
	}
	if source == "" {
		source = "untitled-article"
	}
	return prefix + source
}
func (s *Server) verifyPckt(ctx context.Context, a Row, uri string) (string, error) {
	if !owned(uri, str(a["did"]), "site.standard.publication") {
		return "", fail(422, "The selected publication is not a standard.site publication owned by this account")
	}
	_, _, key, _ := ref(uri)
	standard, e := s.getRecord(ctx, a, "site.standard.publication", key)
	if e != nil {
		return "", e
	}
	if standard == nil || standard.URI != uri || standard.CID == "" || str(standard.Value["$type"]) != "site.standard.publication" {
		return "", fail(422, "The selected standard.site publication record no longer exists")
	}
	publicationURL := str(standard.Value["url"])
	u, e := url.Parse(publicationURL)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return "", fail(422, "The selected standard.site publication must declare a valid HTTPS URL")
	}
	nativeURI := "at://" + str(a["did"]) + "/blog.pckt.publication/" + key
	native, e := s.getRecord(ctx, a, "blog.pckt.publication", key)
	if e != nil {
		return "", e
	}
	if native == nil || native.URI != nativeURI || str(native.Value["$type"]) != "blog.pckt.publication" || object(native.Value["publication"])["uri"] != uri || object(native.Value["publication"])["cid"] != standard.CID {
		return "", fail(422, "The pckt publication does not strongly reference the current standard.site publication")
	}
	body, _, e := s.fetch(ctx, strings.TrimRight(publicationURL, "/")+"/.well-known/site.standard.publication", nil, 64<<10)
	if e != nil || strings.TrimSpace(string(body)) != uri {
		return "", fail(422, "The publication URL does not verify the selected standard.site publication")
	}
	return nativeURI, nil
}
func (s *Server) atomicPublish(ctx context.Context, a Row, host, documentKey, wrapperKey, site string, document Row) (Row, Row, error) {
	head, e := s.head(ctx, a)
	if e != nil {
		return nil, nil, e
	}
	docCID, e := atproto.RecordCID(document)
	if e != nil {
		return nil, nil, e
	}
	docURI := "at://" + str(a["did"]) + "/site.standard.document/" + documentKey
	wrapper, e := anypub.BuildNativeDocumentWrapper(host, Row{"uri": docURI, "cid": docCID}, site, nil)
	if e != nil {
		return nil, nil, e
	}
	collection := "blog.pckt.document"
	if host == "offprint" {
		collection = "app.offprint.document.article"
	}
	wrapperURI := "at://" + str(a["did"]) + "/" + collection + "/" + wrapperKey
	wrapperCID, e := atproto.RecordCID(wrapper)
	if e != nil {
		return nil, nil, e
	}
	writes := []any{}
	for _, entry := range []struct {
		collection, key string
		value           Row
	}{{"site.standard.document", documentKey, document}, {collection, wrapperKey, wrapper}} {
		existing, e := s.getRecord(ctx, a, entry.collection, entry.key)
		if e != nil {
			return nil, nil, e
		}
		action := "create"
		if existing != nil {
			if existing.URI != "at://"+str(a["did"])+"/"+entry.collection+"/"+entry.key {
				return nil, nil, fail(502, "PDS returned an unrelated record")
			}
			action = "update"
		}
		writes = append(writes, Row{"$type": "com.atproto.repo.applyWrites#" + action, "collection": entry.collection, "rkey": entry.key, "value": entry.value})
	}
	var result Row
	if e = s.rpc(ctx, a, "POST", "com.atproto.repo.applyWrites", nil, Row{"repo": a["did"], "swapCommit": head, "validate": true, "writes": writes}, &result); e != nil {
		return nil, nil, e
	}
	if result["results"] != nil {
		results := array(result["results"])
		if len(results) != 2 || object(results[0])["uri"] != docURI || object(results[0])["cid"] != docCID || object(results[1])["uri"] != wrapperURI || object(results[1])["cid"] != wrapperCID {
			return nil, nil, fail(502, "PDS returned unexpected results for the atomic "+host+" document transaction")
		}
	}
	return Row{"uri": docURI, "cid": docCID}, Row{"uri": wrapperURI, "cid": wrapperCID}, nil
}
func (s *Server) Publish(ctx context.Context, d Row) (result Row, err error) {
	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	// Reload under the publisher lock so concurrent HTTP/scheduler requests cannot
	// publish a stale copy or race a retained identity update.
	fresh, e := s.Store.One(ctx, "drafts", "WHERE id=?", d["id"])
	if e != nil {
		return nil, e
	}
	d = fresh
	status := str(d["status"])
	if status != "draft" && status != "failed" && status != "scheduled" && status != "published" {
		return nil, fail(409, "The draft is already being published")
	}
	a, e := s.Store.One(ctx, "linked_accounts", "WHERE did=?", d["account_did"])
	if e != nil {
		return nil, fail(404, "Linked account not found")
	}
	publication, e := s.Store.One(ctx, "publication_cache", "WHERE account_did=? AND uri=?", d["account_did"], d["publication_uri"])
	if e != nil || str(publication["host"]) == "" {
		return nil, fail(422, "The selected publication has no supported content adapter")
	}
	host := str(publication["host"])
	existing := publishingURI(d, "document_uri")
	existingWrapper := publishingURI(d, "platform_document_uri")
	key := recordKey(existing)
	if key == "" {
		key, e = atproto.NewTID()
		if e != nil {
			return nil, e
		}
	}
	wrapperKey := recordKey(existingWrapper)
	if wrapperKey == "" {
		wrapperKey, e = atproto.NewTID()
		if e != nil {
			return nil, e
		}
	}
	if host == "pckt" {
		d["path"] = pcktPath(d, existing != "")
		wrapperKey = key
	}
	if host == "offprint" {
		d["path"] = offprintPath(d, key)
	}
	if _, e = anypub.BuildDocumentRecord(documentInput(d, nil, nil, str(d["plaintext"]), host == "pckt"), nil); e != nil {
		return nil, fail(422, "Invalid document: "+e.Error())
	}
	snapshotInput := Row{"blockDocumentJSON": d["block_document_json"], "markdown": d["markdown"], "blockSchemaVersion": d["block_schema_version"], "blockRevision": d["block_revision"]}
	if e = validateSnapshot(snapshotInput); e != nil {
		return nil, e
	}
	blocks := markdownBlocks(str(d["markdown"]), str(d["block_document_json"]))
	assets := []anypub.ImageAsset{}
	seen := map[string]bool{}
	for _, b := range blocks {
		if b.Kind != "image" {
			continue
		}
		if !strings.HasPrefix(b.URL, "article-asset://") {
			return nil, fail(422, "Upload remote images before publishing native article content")
		}
		id := strings.ToUpper(strings.TrimPrefix(b.URL, "article-asset://"))
		if seen[id] {
			continue
		}
		seen[id] = true
		asset, e := s.Store.One(ctx, "cover_assets", "WHERE id=?", id)
		if e != nil {
			return nil, fail(422, "A body image no longer exists")
		}
		if asset["account_did"] != a["did"] {
			return nil, fail(403, "A body image belongs to another account")
		}
		blob, e := s.assetBlob(ctx, a, asset)
		if e != nil {
			return nil, wrapError(e)
		}
		width, height := num(asset["width"]), num(asset["height"])
		if width < 1 {
			width = 1
		}
		if height < 1 {
			height = 1
		}
		assets = append(assets, anypub.ImageAsset{ID: strings.TrimPrefix(b.URL, "article-asset://"), Blob: blob, Alt: b.Alt, Width: float64(width), Height: float64(height), URL: str(blobURL(a, blobCID(blob)))})
	}
	md := strings.ReplaceAll(str(d["markdown"]), "anypub-asset://", "article-asset://")
	native, e := anypub.BuildArticleNativeContent(anypub.NativeContentInput{Host: host, Markdown: md, Description: str(d["excerpt"]), Assets: assets, Blocks: blocks})
	if e != nil {
		return nil, fail(422, e.Error())
	}
	prepared, e := anypub.PrepareContentOffload(host, native.Content)
	if e != nil {
		return nil, fail(422, e.Error())
	}
	site := ""
	if host == "pckt" {
		site, e = s.verifyPckt(ctx, a, str(d["publication_uri"]))
		if e != nil {
			return nil, e
		}
	}
	d["status"] = "publishing"
	d["plaintext"] = plainMarkdown(str(d["markdown"]))
	d["updated_at"] = now()
	if e = s.Store.Save(ctx, "drafts", d); e != nil {
		return nil, e
	}
	defer func() {
		if err != nil {
			d["status"] = "failed"
			d["updated_at"] = now()
			_ = s.Store.Save(context.WithoutCancel(ctx), "drafts", d)
			_ = s.Store.Save(context.WithoutCancel(ctx), "publish_attempts", Row{"draft_id": d["id"], "status": "failed", "message": err.Error(), "created_at": now()})
		}
	}()
	content := prepared.Content
	if prepared.Offload != nil {
		blob, e := s.uploadBlob(ctx, a, []byte(prepared.Offload.Body), prepared.Offload.MIMEType)
		if e != nil {
			return nil, wrapError(e)
		}
		content, e = anypub.ReplaceContentOffload(prepared, blob)
		if e != nil {
			return nil, e
		}
	}
	var cover Row
	if str(d["cover_asset_id"]) != "" {
		asset, e := s.Store.One(ctx, "cover_assets", "WHERE id=? AND account_did=?", d["cover_asset_id"], a["did"])
		if e != nil {
			return nil, fail(422, "The selected cover image is unavailable")
		}
		cover, e = s.assetBlob(ctx, a, asset)
		if e != nil {
			return nil, wrapError(e)
		}
	}
	document, e := anypub.BuildDocumentRecord(documentInput(d, cover, content, native.TextContent, host == "pckt"), nil)
	if e != nil {
		return nil, fail(422, e.Error())
	}
	var doc, wrapper Row
	if host == "pckt" || host == "offprint" {
		doc, wrapper, e = s.atomicPublish(ctx, a, host, key, wrapperKey, site, document)
	} else {
		writeKey := ""
		if existing != "" {
			writeKey = key
		}
		doc, e = s.writeRecord(ctx, a, "site.standard.document", writeKey, document)
	}
	if e != nil {
		return nil, wrapError(e)
	}
	d["document_uri"] = doc["uri"]
	d["document_cid"] = doc["cid"]
	d["platform_document_uri"] = nil
	d["platform_document_cid"] = nil
	if wrapper != nil {
		d["platform_document_uri"] = wrapper["uri"]
		d["platform_document_cid"] = wrapper["cid"]
	}
	d["retained_document_uri"] = nil
	d["retained_platform_document_uri"] = nil
	d["published_at"], e = timestamp(document["publishedAt"])
	if e != nil {
		return nil, e
	}
	d["status"] = "published"
	d["updated_at"] = now()
	if e = s.Store.Save(ctx, "drafts", d); e != nil {
		return nil, e
	}
	_ = s.calendarUpsert(ctx, d)
	_ = s.Store.Save(ctx, "publish_attempts", Row{"draft_id": d["id"], "status": "published", "created_at": now()})
	result = Row{"documentURI": doc["uri"], "documentCID": doc["cid"], "platformDocumentURI": d["platform_document_uri"], "platformDocumentCID": d["platform_document_cid"], "calendarEventURI": nil, "calendarEventCID": nil}
	if link, e := s.Store.One(ctx, "calendar_event_links", "WHERE draft_id=?", d["id"]); e == nil {
		result["calendarEventURI"] = link["event_uri"]
		result["calendarEventCID"] = link["event_cid"]
	}
	return result, nil
}
func (s *Server) calendarUpsert(ctx context.Context, d Row) error {
	a, e := s.Store.One(ctx, "linked_accounts", "WHERE did=?", d["account_did"])
	if e != nil {
		return e
	}
	starts := d["scheduled_at"]
	if starts == nil {
		starts = d["published_at"]
	}
	if starts == nil {
		starts = now()
	}
	description := str(d["excerpt"])
	if description == "" {
		runes := []rune(str(d["plaintext"]))
		if len(runes) > 280 {
			runes = runes[:280]
		}
		description = string(runes)
	}
	uris := []any{Row{"uri": strings.TrimRight(str(d["publication_url"]), "/") + "/" + strings.TrimLeft(str(d["path"]), "/"), "name": "Article URL"}}
	if str(d["document_uri"]) != "" {
		uris = append(uris, Row{"uri": d["document_uri"], "name": "ATProto record"})
	}
	record := Row{"$type": "community.lexicon.calendar.event", "name": d["title"], "startsAt": iso(starts), "createdAt": iso(now()), "status": "community.lexicon.calendar.event#scheduled", "mode": "community.lexicon.calendar.event#virtual", "description": description, "uris": uris}
	link, e := s.Store.One(ctx, "calendar_event_links", "WHERE draft_id=?", d["id"])
	key := ""
	if e == nil {
		key = recordKey(str(link["event_uri"]))
	} else if e != sql.ErrNoRows {
		return e
	}
	event, e := s.writeRecord(ctx, a, "community.lexicon.calendar.event", key, record)
	if e != nil {
		return e
	}
	if link == nil {
		link = Row{"draft_id": d["id"]}
	}
	link["event_uri"] = event["uri"]
	link["event_cid"] = event["cid"]
	link["updated_at"] = now()
	return s.Store.Save(ctx, "calendar_event_links", link)
}
func (s *Server) calendarDelete(ctx context.Context, d Row) error {
	link, e := s.Store.One(ctx, "calendar_event_links", "WHERE draft_id=?", d["id"])
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	a, e := s.Store.One(ctx, "linked_accounts", "WHERE did=?", d["account_did"])
	if e != nil {
		return fail(404, "Linked account not found")
	}
	if e = s.deleteRecord(ctx, a, str(link["event_uri"])); e != nil {
		return wrapError(e)
	}
	return s.Store.Delete(ctx, "calendar_event_links", str(link["id"]))
}
func (s *Server) Unpublish(ctx context.Context, d Row) error {
	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	if str(d["document_uri"]) == "" {
		return nil
	}
	a, e := s.Store.One(ctx, "linked_accounts", "WHERE did=?", d["account_did"])
	if e != nil {
		return fail(404, "Linked account not found")
	}
	if !owned(str(d["document_uri"]), str(a["did"]), "site.standard.document") {
		return fail(400, "Published linkage is not a standard.site document")
	}
	if e = s.calendarDelete(ctx, d); e != nil {
		return e
	}
	platform := str(d["platform_document_uri"])
	if platform != "" {
		repo, col, key, e := ref(platform)
		if e != nil || repo != a["did"] {
			return fail(400, "Invalid native document linkage")
		}
		if col == "blog.pckt.document" || col == "app.offprint.document.article" {
			if col == "blog.pckt.document" && key != recordKey(str(d["document_uri"])) {
				return fail(400, "Invalid pckt document linkage")
			}
			head, e := s.head(ctx, a)
			if e != nil {
				return e
			}
			writes := []any{Row{"$type": "com.atproto.repo.applyWrites#delete", "collection": col, "rkey": key}, Row{"$type": "com.atproto.repo.applyWrites#delete", "collection": "site.standard.document", "rkey": recordKey(str(d["document_uri"]))}}
			var out Row
			if e = s.rpc(ctx, a, "POST", "com.atproto.repo.applyWrites", nil, Row{"repo": a["did"], "swapCommit": head, "writes": writes}, &out); e != nil {
				return wrapError(e)
			}
		} else {
			if e = s.deleteRecord(ctx, a, platform); e != nil {
				return wrapError(e)
			}
			if e = s.deleteRecord(ctx, a, str(d["document_uri"])); e != nil {
				return wrapError(e)
			}
		}
	} else if e = s.deleteRecord(ctx, a, str(d["document_uri"])); e != nil {
		return wrapError(e)
	}
	d["retained_document_uri"] = d["document_uri"]
	d["retained_platform_document_uri"] = d["platform_document_uri"]
	for _, k := range []string{"document_uri", "document_cid", "platform_document_uri", "platform_document_cid", "published_at", "scheduled_at"} {
		d[k] = nil
	}
	d["status"] = "draft"
	d["updated_at"] = now()
	return s.Store.Save(ctx, "drafts", d)
}
func (s *Server) RunScheduled(ctx context.Context) error {
	start := now()
	drafts, e := s.Store.Rows(ctx, "drafts", "WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at", now())
	if e != nil {
		return e
	}
	published, failed := 0, 0
	for _, d := range drafts {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, e = s.Publish(ctx, d); e != nil {
			failed++
			fmt.Printf("Scheduled publish failed for %s: %v\n", d["id"], e)
		} else {
			published++
		}
	}
	return s.Store.Save(ctx, "scheduler_runs", Row{"started_at": start, "finished_at": now(), "published_count": published, "failed_count": failed})
}
func (s *Server) StartScheduler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.RunScheduled(ctx)
			}
		}
	}()
}
