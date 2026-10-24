package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

type importedImage struct {
	Blob          Row
	Alt           string
	Width, Height int
}

func (s *Server) fetchBlob(ctx context.Context, a Row, cid string) ([]byte, error) {
	var data []byte
	e := s.publicRPC(ctx, a, "com.atproto.sync.getBlob", url.Values{"did": {str(a["did"])}, "cid": {cid}}, &data)
	if len(data) > 10<<20 {
		return nil, fail(502, "Published blob is too large")
	}
	return data, e
}
func (s *Server) localImage(ctx context.Context, a Row, image importedImage) (Row, error) {
	cid := blobCID(image.Blob)
	if cid == "" {
		return nil, nil
	}
	data, e := s.fetchBlob(ctx, a, cid)
	if e != nil {
		return nil, nil
	}
	mime := str(image.Blob["mimeType"])
	if mime == "" {
		mime = "application/octet-stream"
	}
	blob := Row{"$type": "blob", "ref": Row{"$link": cid}, "mimeType": mime, "size": len(data)}
	return s.storeAsset(ctx, a, data, mime, "publication", nullable(image.Alt), image.Width, image.Height, nil, blob)
}
func (s *Server) backfill(w http.ResponseWriter, r *http.Request) (any, error) {
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
	s.importMu.Lock()
	defer s.importMu.Unlock()
	pubs, e := s.Store.Rows(r.Context(), "publication_cache", "WHERE account_did=?", a["did"])
	if e != nil {
		return nil, e
	}
	if len(pubs) == 0 {
		pubs, e = s.discover(r.Context(), a)
		if e != nil {
			return nil, wrapError(e)
		}
	}
	byURI := map[string]Row{}
	for _, p := range pubs {
		byURI[str(p["uri"])] = p
	}
	out := []Row{}
	if len(pubs) == 0 {
		return out, nil
	}
	existing, e := s.Store.Rows(r.Context(), "drafts", "WHERE account_did=?", a["did"])
	if e != nil {
		return nil, e
	}
	known := map[string]bool{}
	for _, d := range existing {
		known[str(d["document_uri"])] = true
		known[str(d["retained_document_uri"])] = true
	}
	documents, e := s.listRecords(r.Context(), a, "site.standard.document", 50)
	if e != nil {
		return nil, wrapError(e)
	}
	wrappers := map[string]RepositoryRecord{}
	for _, collection := range []string{"blog.pckt.document", "app.offprint.document.article"} {
		records, e := s.listRecords(r.Context(), a, collection, 50)
		if e != nil {
			continue
		}
		for _, record := range records {
			if owned(record.URI, str(a["did"]), collection) {
				uri := str(object(record.Value["document"])["uri"])
				if owned(uri, str(a["did"]), "site.standard.document") && record.CID != "" {
					wrappers[uri] = record
				}
			}
		}
	}
	for _, record := range documents {
		v := record.Value
		p := byURI[str(v["site"])]
		if p == nil || known[record.URI] || !owned(record.URI, str(a["did"]), "site.standard.document") || (str(v["$type"]) != "" && str(v["$type"]) != "site.standard.document") {
			continue
		}
		d, e := s.importDocument(r.Context(), a, p, record, wrappers[record.URI])
		if e != nil {
			continue
		}
		if e = s.Store.Save(r.Context(), "drafts", d); e != nil {
			return nil, e
		}
		known[record.URI] = true
		out = append(out, draftResponse(d))
	}
	return out, nil
}
func (s *Server) importDocument(ctx context.Context, a, p Row, record, wrapper RepositoryRecord) (Row, error) {
	v := record.Value
	c := object(v["content"])
	var contentBlob []byte
	for _, candidate := range []any{c["blobPages"], c["blob"], object(c["text"])["textBlob"]} {
		if cid := blobCID(candidate); cid != "" {
			contentBlob, _ = s.fetchBlob(ctx, a, cid)
			break
		}
	}
	md, images := importBody(v, contentBlob)
	desc := str(v["description"])
	parts := strings.Split(md, "\n\n")
	if desc != "" && len(parts) > 0 && headingRE.MatchString(parts[0]) && strings.TrimSpace(headingRE.ReplaceAllString(parts[0], "")) == desc {
		md = strings.Join(parts[1:], "\n\n")
	}
	resolved := map[string]string{}
	for _, image := range images {
		cid := blobCID(image.Blob)
		if resolved[cid] != "" {
			md = strings.ReplaceAll(md, "anypub-import-blob://"+cid, resolved[cid])
			continue
		}
		asset, e := s.localImage(ctx, a, image)
		if e != nil {
			return nil, e
		}
		placeholder := "anypub-import-blob://" + cid
		if asset != nil {
			resolved[cid] = "anypub-asset://" + str(asset["id"])
			md = strings.ReplaceAll(md, placeholder, resolved[cid])
		} else {
			lines := strings.Split(md, "\n")
			for i, line := range lines {
				if strings.Contains(line, placeholder) {
					line = strings.ReplaceAll(line, placeholder, str(blobURL(a, cid)))
					lines[i] = strings.TrimPrefix(line, "!")
				}
			}
			md = strings.Join(lines, "\n")
		}
	}
	cover, e := s.localImage(ctx, a, importedImage{Blob: object(v["coverImage"]), Alt: str(v["title"])})
	if e != nil {
		return nil, e
	}
	published := now()
	if t, e := timestamp(v["publishedAt"]); e == nil {
		published = t
	} else if t, e := timestamp(v["updatedAt"]); e == nil {
		published = t
	}
	updated := published
	if t, e := timestamp(v["updatedAt"]); e == nil {
		updated = t
	}
	title := strings.TrimSpace(str(v["title"]))
	if title == "" {
		title = "Untitled post"
	}
	d := Row{"account_did": a["did"], "publication_uri": p["uri"], "publication_url": p["url"], "title": title, "path": nullable(v["path"]), "excerpt": nullable(v["description"]), "tags_json": jsonString(array(v["tags"])), "markdown": md, "plaintext": plainMarkdown(md), "block_schema_version": 1, "block_revision": 0, "status": "published", "published_at": published, "created_at": published, "updated_at": updated, "document_uri": record.URI, "document_cid": record.CID}
	if cover != nil {
		d["cover_asset_id"] = cover["id"]
	}
	if wrapper.URI != "" {
		d["platform_document_uri"] = wrapper.URI
		d["platform_document_cid"] = wrapper.CID
	}
	return d, nil
}
func firstValue(m Row, keys ...string) any {
	for _, k := range keys {
		if m[k] != nil {
			return m[k]
		}
	}
	return nil
}
func blockKind(m Row) string {
	s := strings.Split(str(m["$type"]), ".")
	return strings.ToLower(s[len(s)-1])
}
func importedInline(m Row) string {
	text := str(firstValue(m, "plaintext", "text"))
	type facet struct {
		start, end int
		kind, uri  string
	}
	facets := []facet{}
	for _, f := range array(m["facets"]) {
		f := object(f)
		idx := object(f["index"])
		start, end := num(idx["byteStart"]), num(idx["byteEnd"])
		if start < 0 || end <= start || end > len(text) {
			continue
		}
		for _, feature := range array(f["features"]) {
			x := object(feature)
			parts := strings.Split(str(x["$type"]), "#")
			kind := strings.ToLower(parts[len(parts)-1])
			switch kind {
			case "bold", "strong", "italic", "em", "code", "strikethrough", "strike", "underline", "link":
				facets = append(facets, facet{start, end, kind, str(firstValue(x, "uri", "href"))})
			}
			break
		}
	}
	sort.SliceStable(facets, func(i, j int) bool {
		if facets[i].start == facets[j].start {
			return facets[i].end > facets[j].end
		}
		return facets[i].start < facets[j].start
	})
	var render func(int, int, []facet) string
	render = func(lower, upper int, fs []facet) string {
		output := ""
		cursor := lower
		for i := 0; i < len(fs); {
			f := fs[i]
			if f.start < cursor || f.end > upper {
				i++
				continue
			}
			output += text[cursor:f.start]
			nested := []facet{}
			next := i + 1
			for next < len(fs) && fs[next].start < f.end {
				if fs[next].end <= f.end {
					nested = append(nested, fs[next])
				}
				next++
			}
			inner := text[f.start:f.end]
			if f.kind != "code" {
				inner = render(f.start, f.end, nested)
			}
			marker := ""
			switch f.kind {
			case "bold", "strong":
				marker = "**"
			case "italic", "em":
				marker = "*"
			case "strikethrough", "strike":
				marker = "~~"
			case "underline":
				marker = "++"
			case "code":
				if !strings.Contains(inner, "`") {
					marker = "`"
				}
			case "link":
				if !strings.ContainsAny(f.uri, ") ") && !strings.Contains(inner, "]") {
					inner = "[" + inner + "](" + f.uri + ")"
				}
			}
			output += marker + inner + marker
			cursor = f.end
			i = next
		}
		return output + text[cursor:upper]
	}
	return render(0, len(text), facets)
}
func importBody(v Row, blob []byte) (string, []importedImage) {
	c := object(v["content"])
	text := object(c["text"])
	if _, ok := text["markdown"].(string); ok {
		md := str(text["markdown"])
		if blobCID(text["textBlob"]) != "" && blob != nil {
			md = string(blob)
		}
		return normalizeMarkdown(md), nil
	}
	if blobCID(text["textBlob"]) != "" && blob != nil {
		return normalizeMarkdown(string(blob)), nil
	}
	blocks := []any{}
	offloaded := parsedString(string(blob))
	if c["pages"] != nil || c["blobPages"] != nil {
		pages := array(c["pages"])
		if offloaded != nil {
			pages = array(offloaded)
			if len(pages) == 0 {
				pages = array(object(offloaded)["pages"])
			}
		}
		for _, page := range pages {
			for _, entry := range array(object(page)["blocks"]) {
				if b := object(entry)["block"]; b != nil {
					blocks = append(blocks, b)
				} else {
					blocks = append(blocks, entry)
				}
			}
		}
	} else {
		blocks = array(c["items"])
		if offloaded != nil {
			blocks = array(offloaded)
			if len(blocks) == 0 {
				blocks = array(object(offloaded)["items"])
			}
		}
	}
	images := []importedImage{}
	parts := []string{}
	for _, b := range blocks {
		if rendered := renderImportedBlock(object(b), &images); rendered != "" {
			parts = append(parts, rendered)
		}
	}
	if len(parts) == 0 {
		for _, line := range strings.Split(str(v["textContent"]), "\n") {
			if strings.TrimSpace(line) != "" {
				parts = append(parts, strings.TrimSpace(line))
			}
		}
	}
	return normalizeMarkdown(strings.Join(parts, "\n\n")), images
}
func normalizeMarkdown(md string) string {
	md = strings.ReplaceAll(strings.ReplaceAll(md, "\r\n", "\n"), "\r", "\n")
	for strings.Contains(md, "\n\n\n") {
		md = strings.ReplaceAll(md, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(md)
}
func renderImportedBlock(m Row, images *[]importedImage) string {
	kind := blockKind(m)
	switch kind {
	case "header", "heading":
		level := num(m["level"])
		if level < 1 {
			level = 1
		}
		if level > 6 {
			level = 6
		}
		return strings.Repeat("#", level) + " " + importedInline(m)
	case "quote", "blockquote":
		lines := []string{}
		if children := array(firstValue(m, "content", "children")); len(children) > 0 {
			for _, c := range children {
				lines = append(lines, strings.Split(importedInline(object(c)), "\n")...)
			}
		} else {
			lines = strings.Split(importedInline(m), "\n")
		}
		for i := range lines {
			lines[i] = "> " + lines[i]
		}
		return strings.Join(lines, "\n")
	case "unorderedlist", "bulletlist", "orderedlist", "tasklist", "checklist":
		return strings.Join(importList(m, 0, images), "\n")
	case "code", "codeblock":
		source := str(firstValue(m, "plaintext", "code", "text"))
		if source == "" {
			return ""
		}
		return "```" + str(m["language"]) + "\n" + source + "\n```"
	case "horizontalrule", "rule", "divider", "separator":
		return "---"
	case "image":
		attrs := object(m["attrs"])
		blob := firstValue(m, "image", "blob")
		if blob == nil {
			blob = firstValue(attrs, "blob", "image")
		}
		if blobCID(blob) == "" {
			return ""
		}
		alt := str(m["alt"])
		if alt == "" {
			alt = str(attrs["alt"])
		}
		ratio := object(m["aspectRatio"])
		if len(ratio) == 0 {
			ratio = object(attrs["aspectRatio"])
		}
		*images = append(*images, importedImage{object(blob), alt, num(ratio["width"]), num(ratio["height"])})
		alt = strings.NewReplacer("]", "", "\n", " ", "\r", " ").Replace(alt)
		return "![" + alt + "](anypub-import-blob://" + blobCID(blob) + ")"
	case "website", "webembed", "embed", "link", "bookmark":
		u := str(firstValue(m, "src", "href", "uri", "url"))
		parsed, e := url.Parse(u)
		if e != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || strings.Contains(u, ")") {
			return ""
		}
		return "@[embed](" + u + ")"
	}
	return importedInline(m)
}
func importList(m Row, level int, images *[]importedImage) []string {
	kind := blockKind(m)
	items := array(firstValue(m, "children", "content"))
	start := num(firstValue(m, "startIndex", "start"))
	if start < 1 {
		start = 1
	}
	return importListItems(items, kind, start, level, images)
}
func importListItems(items []any, kind string, start, level int, images *[]importedImage) []string {
	lines := []string{}
	if level > 4 {
		level = 4
	}
	for i, item := range items {
		x := object(item)
		text := ""
		nested := []Row{}
		if content, ok := x["content"].(map[string]any); ok {
			text = importedInline(content)
		} else if content, ok := x["content"].([]any); ok {
			for _, entry := range content {
				b := object(entry)
				if strings.Contains(blockKind(b), "list") {
					nested = append(nested, b)
				} else if text == "" {
					text = importedInline(b)
				}
			}
		} else {
			text = importedInline(x)
		}
		marker := "- "
		if kind == "orderedlist" {
			marker = fmt.Sprintf("%d. ", start+i)
		}
		if checked, ok := x["checked"].(bool); ok || kind == "tasklist" || kind == "checklist" {
			marker = "- [ ] "
			if checked {
				marker = "- [x] "
			}
		}
		lines = append(lines, strings.Repeat("\t", level)+marker+strings.ReplaceAll(text, "\n", " "))
		if children := array(x["children"]); len(children) > 0 {
			lines = append(lines, importListItems(children, kind, 1, level+1, images)...)
		}
		for _, key := range []string{"unorderedListChildren", "orderedListChildren"} {
			if child := object(x[key]); len(child) > 0 {
				if child["$type"] == nil {
					child["$type"] = "unorderedList"
					if key == "orderedListChildren" {
						child["$type"] = "orderedList"
					}
				}
				lines = append(lines, importList(child, level+1, images)...)
			}
		}
		for _, child := range nested {
			lines = append(lines, importList(child, level+1, images)...)
		}
	}
	return lines
}
