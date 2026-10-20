package backend

import (
	"encoding/json"
	anypub "github.com/stygian-tech/anypub-kit"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var listRE = regexp.MustCompile(`^([ \t]*)([-*+]|\d+\.)(?:\s+|$)`)
var imageRE = regexp.MustCompile(`^!\[([^\]]*)\]\((anypub-asset://[^)]+|article-asset://[^)]+|https?://[^)]+)\)$`)
var headingRE = regexp.MustCompile(`^(#{1,6})\s+`)
var thematicRE = regexp.MustCompile(`^(?:[-*_]\s*){3,}$`)

type snapshotBlock struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Source       string `json:"source"`
	HeadingLevel int    `json:"headingLevel"`
	ListLevel    int    `json:"listLevel"`
	ListStart    int    `json:"listStart"`
	Language     string `json:"language"`
}
type snapshot struct {
	SchemaVersion int             `json:"schemaVersion"`
	Revision      int             `json:"revision"`
	Markdown      string          `json:"markdown"`
	Blocks        []snapshotBlock `json:"blocks"`
}

func validateSnapshot(in Row) error {
	if in["blockDocumentJSON"] == nil {
		return nil
	}
	var snap snapshot
	if e := json.Unmarshal([]byte(str(in["blockDocumentJSON"])), &snap); e != nil {
		return fail(422, "Invalid block document JSON")
	}
	if snap.SchemaVersion != 1 || (in["blockSchemaVersion"] != nil && num(in["blockSchemaVersion"]) != snap.SchemaVersion) {
		return fail(422, "Unsupported block document schema version")
	}
	if snap.Revision < 0 || (in["blockRevision"] != nil && num(in["blockRevision"]) != snap.Revision) {
		return fail(422, "Block document revision does not match the draft")
	}
	if snap.Markdown != str(in["markdown"]) {
		return fail(422, "Block document Markdown does not match the draft")
	}
	ids := map[string]bool{}
	rebuilt := ""
	previous := ""
	for _, b := range snap.Blocks {
		if b.ID == "" || ids[b.ID] {
			return fail(422, "Block document IDs must be non-empty and unique")
		}
		ids[b.ID] = true
		valid := true
		switch b.Kind {
		case "heading":
			valid = b.HeadingLevel >= 1 && b.HeadingLevel <= 6
		case "unordered-list", "ordered-list":
			valid = b.ListLevel >= 0 && b.ListLevel <= 4 && (b.Kind != "ordered-list" || b.ListStart >= 1)
		case "image":
			valid = imageRE.MatchString(strings.TrimSpace(b.Source))
		case "embed":
			valid = embedURL(b.Source) != ""
		case "empty", "thematic-break", "quote", "code", "paragraph":
		default:
			valid = false
		}
		if !valid {
			return fail(422, "Block document contains invalid block metadata")
		}
		if strings.TrimSpace(b.Source) == "" {
			continue
		}
		source := strings.TrimSpace(b.Source)
		if strings.HasSuffix(b.Kind, "-list") {
			source = strings.Trim(b.Source, "\r\n")
		}
		sep := "\n\n"
		if previous == b.Kind && strings.HasSuffix(b.Kind, "-list") {
			sep = "\n"
		}
		if rebuilt == "" {
			sep = ""
		}
		rebuilt += sep + source
		previous = b.Kind
	}
	if rebuilt != snap.Markdown {
		return fail(422, "Block document Markdown does not match its blocks")
	}
	return nil
}
func embedURL(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "@[embed](") || !strings.HasSuffix(s, ")") {
		return ""
	}
	v := strings.TrimSuffix(strings.TrimPrefix(s, "@[embed]("), ")")
	u, e := url.Parse(v)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	return v
}
func block(source string) anypub.MarkdownBlock {
	b := anypub.MarkdownBlock{Kind: "paragraph", Source: source}
	t := strings.TrimSpace(source)
	switch {
	case strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~"):
		b.Kind = "code"
		b.Language = strings.TrimSpace(strings.Split(t, "\n")[0][3:])
	case imageRE.MatchString(t):
		m := imageRE.FindStringSubmatch(t)
		b.Kind = "image"
		b.Alt = m[1]
		b.URL = strings.Replace(m[2], "anypub-asset://", "article-asset://", 1)
	case embedURL(t) != "":
		b.Kind = "embed"
		b.URL = embedURL(t)
	case thematicRE.MatchString(t):
		b.Kind = "thematic-break"
	case headingRE.MatchString(t):
		b.Kind = "heading"
		b.HeadingLevel = len(headingRE.FindStringSubmatch(t)[1])
	case strings.HasPrefix(t, ">"):
		b.Kind = "quote"
	case listRE.MatchString(source):
		m := listRE.FindStringSubmatch(source)
		b.Kind = "unordered-list"
		b.ListLevel = strings.Count(m[1], "\t") + strings.Count(m[1], " ")/2
		if strings.HasSuffix(m[2], ".") {
			b.Kind = "ordered-list"
			b.ListStart, _ = strconv.Atoi(strings.TrimSuffix(m[2], "."))
		}
	}
	return b
}
func markdownBlocks(markdown, snapshotJSON string) []anypub.MarkdownBlock {
	if snapshotJSON != "" {
		var s snapshot
		if json.Unmarshal([]byte(snapshotJSON), &s) == nil {
			out := []anypub.MarkdownBlock{}
			for _, x := range s.Blocks {
				b := block(x.Source)
				b.Kind = x.Kind
				b.HeadingLevel = x.HeadingLevel
				b.ListLevel = x.ListLevel
				b.ListStart = x.ListStart
				b.Language = x.Language
				if b.Kind != "empty" {
					out = append(out, b)
				}
			}
			return out
		}
	}
	md := strings.ReplaceAll(strings.ReplaceAll(markdown, "\r\n", "\n"), "\r", "\n")
	lines := strings.Split(md, "\n")
	out := []anypub.MarkdownBlock{}
	buf := []string{}
	fence := ""
	flush := func() {
		if len(buf) > 0 {
			out = append(out, block(strings.Join(buf, "\n")))
			buf = nil
		}
	}
	for _, line := range lines {
		t := strings.TrimSpace(line)
		if fence != "" {
			buf = append(buf, line)
			if strings.HasPrefix(t, fence) {
				flush()
				fence = ""
			}
			continue
		}
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			flush()
			fence = t[:3]
			buf = append(buf, line)
			continue
		}
		if t == "" {
			flush()
			continue
		}
		if listRE.MatchString(line) {
			flush()
			out = append(out, block(line))
			continue
		}
		if headingRE.MatchString(t) || imageRE.MatchString(t) || embedURL(t) != "" || thematicRE.MatchString(t) {
			flush()
			out = append(out, block(line))
			continue
		}
		if len(buf) > 0 && strings.HasPrefix(strings.TrimSpace(buf[0]), ">") != strings.HasPrefix(t, ">") {
			flush()
		}
		buf = append(buf, line)
	}
	flush()
	return out
}
func plainMarkdown(md string) string {
	blocks := markdownBlocks(md, "")
	out := []string{}
	for _, b := range blocks {
		source := b.Source
		switch b.Kind {
		case "image":
			source = b.Alt
		case "embed":
			source = b.URL
		case "thematic-break":
			continue
		case "heading":
			source = headingRE.ReplaceAllString(source, "")
		case "unordered-list", "ordered-list":
			source = listRE.ReplaceAllString(source, "")
			source = regexp.MustCompile(`^\[[xX ]\]\s*`).ReplaceAllString(source, "")
		case "quote":
			source = regexp.MustCompile(`(?m)^\s*>\s?`).ReplaceAllString(source, "")
		case "code":
			l := strings.Split(source, "\n")
			if len(l) > 1 {
				l = l[1:]
			}
			if len(l) > 0 && (strings.TrimSpace(l[len(l)-1]) == "```" || strings.TrimSpace(l[len(l)-1]) == "~~~") {
				l = l[:len(l)-1]
			}
			source = strings.Join(l, "\n")
		}
		if b.Kind != "code" {
			source = str(anypub.ArticleRichText(source, "")["plaintext"])
		}
		if source != "" {
			out = append(out, source)
		}
	}
	return strings.Join(out, "\n")
}
