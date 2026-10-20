package backend

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var imageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

func (s *Server) assets(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	if r.URL.Query().Get("accountDID") == "" {
		return nil, fail(400, "Missing accountDID")
	}
	rows, e := s.Store.Rows(r.Context(), "cover_assets", "WHERE account_did=? ORDER BY created_at DESC", a["did"])
	out := []Row{}
	for _, row := range rows {
		out = append(out, response(row))
	}
	return out, e
}
func (s *Server) storeAsset(ctx context.Context, a Row, data []byte, mime, source string, alt any, width, height int, attribution any, blob Row) (Row, error) {
	dir := filepath.Join(s.Config.UploadsDir, hexHash(str(a["did"])))
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	p := filepath.Join(dir, uuid())
	if e := os.WriteFile(p, data, 0600); e != nil {
		return nil, e
	}
	asset := Row{"account_did": a["did"], "source": source, "file_path": p, "mime_type": mime, "byte_size": len(data), "alt_text": alt, "created_at": now()}
	if width > 0 {
		asset["width"] = width
	}
	if height > 0 {
		asset["height"] = height
	}
	if attribution != nil {
		asset["attribution_json"] = jsonString(attribution)
	}
	if blob != nil {
		asset["blob_json"] = jsonString(blob)
	}
	if e := s.Store.Save(ctx, "cover_assets", asset); e != nil {
		_ = os.Remove(p)
		return nil, e
	}
	return asset, nil
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	if e = r.ParseMultipartForm(2 << 20); e != nil {
		return nil, fail(400, "Invalid image upload")
	}
	defer r.MultipartForm.RemoveAll()
	if e = requireDID(a, r.FormValue("accountDID")); e != nil {
		return nil, e
	}
	file, header, e := r.FormFile("file")
	if e != nil {
		return nil, fail(400, "Missing image file")
	}
	defer file.Close()
	mime := strings.ToLower(strings.Split(header.Header.Get("Content-Type"), ";")[0])
	if !imageTypes[mime] {
		return nil, fail(415, "Upload a PNG, JPEG, GIF, or WebP image")
	}
	data, e := io.ReadAll(io.LimitReader(file, 1000001))
	if e != nil {
		return nil, e
	}
	if len(data) > 1000000 {
		return nil, fail(413, "Images must be 1 MB or smaller for publication compatibility")
	}
	width, height := 0, 0
	for key, dest := range map[string]*int{"width": &width, "height": &height} {
		if v := r.FormValue(key); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || n <= 0 {
				return nil, fail(422, "Image dimensions must be positive")
			}
			*dest = n
		}
	}
	asset, e := s.storeAsset(r.Context(), a, data, mime, "device", nullable(r.FormValue("altText")), width, height, nil, nil)
	return response(asset), e
}
func (s *Server) assetContent(w http.ResponseWriter, r *http.Request) (any, error) {
	a, e := s.account(r)
	if e != nil {
		return nil, e
	}
	asset, e := s.Store.One(r.Context(), "cover_assets", "WHERE id=? AND account_did=?", strings.ToUpper(r.PathValue("id")), a["did"])
	if e != nil {
		return nil, fail(404, "Image asset not found")
	}
	data, e := os.ReadFile(str(asset["file_path"]))
	if e != nil {
		return nil, e
	}
	w.Header().Set("Content-Type", str(asset["mime_type"]))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(200)
	_, e = w.Write(data)
	return sentResponse{}, e
}
func (s *Server) assetBlob(ctx context.Context, a, asset Row) (Row, error) {
	if blob := object(parsed(asset["blob_json"])); blobCID(blob) != "" {
		return blob, nil
	}
	data, e := os.ReadFile(str(asset["file_path"]))
	if e != nil {
		return nil, e
	}
	blob, e := s.uploadBlob(ctx, a, data, str(asset["mime_type"]))
	if e != nil {
		return nil, e
	}
	asset["blob_json"] = jsonString(blob)
	return blob, s.Store.Save(ctx, "cover_assets", asset)
}
func (s *Server) fetch(ctx context.Context, target string, headers map[string]string, limit int) ([]byte, string, error) {
	req, e := http.NewRequestWithContext(ctx, "GET", target, nil)
	if e != nil {
		return nil, "", e
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, e := s.HTTP.Do(req)
	if e != nil {
		return nil, "", e
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, "", fail(502, "Upstream download failed")
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, int64(limit)+1))
	if len(b) > limit {
		return nil, "", fail(502, "Upstream response is too large")
	}
	return b, strings.Split(res.Header.Get("Content-Type"), ";")[0], e
}
func (s *Server) unsplashSearch(w http.ResponseWriter, r *http.Request) (any, error) {
	if _, e := s.account(r); e != nil {
		return nil, e
	}
	if s.Config.UnsplashKey == "" {
		return nil, fail(503, "Unsplash is not configured")
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	q := url.Values{"query": {r.URL.Query().Get("q")}, "page": {strconv.Itoa(page)}, "per_page": {"18"}, "content_filter": {"high"}}
	data, _, e := s.fetch(r.Context(), "https://api.unsplash.com/search/photos?"+q.Encode(), map[string]string{"Authorization": "Client-ID " + s.Config.UnsplashKey, "Accept-Version": "v1"}, 4<<20)
	if e != nil {
		return nil, e
	}
	var out any
	out = parsedString(string(data))
	if out == nil {
		return nil, fail(502, "Invalid Unsplash response")
	}
	return out, nil
}
func (s *Server) unsplashSelect(w http.ResponseWriter, r *http.Request) (any, error) {
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
	if s.Config.UnsplashKey == "" {
		return nil, fail(503, "Unsplash is not configured")
	}
	download, e := url.Parse(str(in["downloadLocation"]))
	if e != nil || download.Scheme != "https" || download.Host != "api.unsplash.com" || download.User != nil {
		return nil, fail(422, "Invalid Unsplash download URL")
	}
	image, e := url.Parse(str(in["imageURL"]))
	if e != nil || image.Scheme != "https" || image.Host != "images.unsplash.com" || image.User != nil {
		return nil, fail(422, "Invalid Unsplash image URL")
	}
	if _, _, e = s.fetch(r.Context(), download.String(), map[string]string{"Authorization": "Client-ID " + s.Config.UnsplashKey, "Accept-Version": "v1"}, 1<<20); e != nil {
		return nil, e
	}
	data, mime, e := s.fetch(r.Context(), image.String(), nil, 8<<20)
	if e != nil {
		return nil, e
	}
	if !imageTypes[mime] {
		return nil, fail(415, "Unsplash did not return an image")
	}
	attribution := Row{}
	for _, k := range []string{"photoID", "photographerName", "photographerUsername", "photographerURL", "unsplashURL", "downloadLocation"} {
		attribution[k] = in[k]
	}
	asset, e := s.storeAsset(r.Context(), a, data, mime, "unsplash", in["altText"], 0, 0, attribution, nil)
	return response(asset), e
}
