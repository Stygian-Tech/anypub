package backend

import (
	"encoding/json"
	anypub "github.com/stygian-tech/anypub-kit"
	"strings"
	"testing"
)

func TestMarkdownStructuralParsing(t *testing.T) {
	cases := []struct {
		name, md, kind, source string
		level                  int
	}{{"ATX heading", "# Heading", "heading", "Heading", 1}, {"setext heading", "Setext Heading\n====", "heading", "Setext Heading", 1}, {"setext subtitle", "Subtitle\n----", "heading", "Subtitle", 2}, {"four tick literal", "````go\ncode\n```\nmore\n````", "code", "code\n```\nmore", 0}, {"unclosed tilde", "~~~swift\nlet x = 1\n```", "code", "let x = 1\n```", 0}, {"code leading hash", "```md\n# literal\n```", "code", "# literal", 0}, {"empty code", "```\n```", "code", "", 0}, {"quote", "> One\n> Two", "quote", "> One\n> Two", 0}, {"rule", "---", "thematic-break", "---", 0}, {"paragraph", "Hello **world**", "paragraph", "Hello **world**", 0}, {"embed", "@[embed](https://example.com)", "embed", "@[embed](https://example.com)", 0}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			blocks := markdownBlocks(tc.md, "")
			if len(blocks) != 1 || blocks[0].Kind != tc.kind || blocks[0].Source != tc.source || blocks[0].HeadingLevel != tc.level {
				t.Fatalf("%#v", blocks)
			}
			for _, host := range []string{"leaflet", "offprint", "pckt", "markpub"} {
				native, e := anypub.BuildArticleNativeContent(anypub.NativeContentInput{Host: host, Markdown: tc.md, Blocks: blocks})
				if e != nil {
					t.Fatal(e)
				}
				if tc.kind == "heading" && !strings.Contains(native.TextContent, tc.source) {
					t.Fatalf("heading stripped: %q", native.TextContent)
				}
				if tc.kind == "code" && native.TextContent != tc.source {
					t.Fatalf("code changed: %q", native.TextContent)
				}
			}
		})
	}
}
func TestNestedListParsing(t *testing.T) {
	md := "1. First\n   - Nested\n   - [x] Task\n2. Second"
	blocks := markdownBlocks(md, "")
	if len(blocks) != 4 || blocks[0].Kind != "ordered-list" || blocks[1].Kind != "unordered-list" || blocks[1].ListLevel != 1 || blocks[3].ListStart != 2 {
		t.Fatalf("%#v", blocks)
	}
	for _, host := range []string{"leaflet", "offprint", "pckt"} {
		if _, e := anypub.BuildArticleNativeContent(anypub.NativeContentInput{Host: host, Markdown: md, Blocks: blocks}); e != nil {
			t.Fatal(e)
		}
	}
}
func TestSnapshotValidationAndNormalizedSources(t *testing.T) {
	blocks := []snapshotBlock{{ID: "heading", Kind: "heading", Source: "## Heading", HeadingLevel: 2}, {ID: "code", Kind: "code", Source: "````md\n# literal\n```\n````", Language: "md"}}
	md := blocks[0].Source + "\n\n" + blocks[1].Source
	snap := snapshot{SchemaVersion: 1, Revision: 2, Markdown: md, Blocks: blocks}
	in := Row{"blockDocumentJSON": jsonString(snap), "markdown": md, "blockSchemaVersion": 1, "blockRevision": 2}
	if e := validateSnapshot(in); e != nil {
		t.Fatal(e)
	}
	parsed := markdownBlocks(md, str(in["blockDocumentJSON"]))
	if parsed[0].Source != "Heading" || parsed[1].Source != "# literal\n```" {
		t.Fatalf("snapshot not normalized %#v", parsed)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*snapshot)
	}{{"schema", func(s *snapshot) { s.SchemaVersion = 2 }}, {"revision", func(s *snapshot) { s.Revision = -1 }}, {"duplicate IDs", func(s *snapshot) { s.Blocks[1].ID = s.Blocks[0].ID }}, {"empty ID", func(s *snapshot) { s.Blocks[0].ID = "" }}, {"kind", func(s *snapshot) { s.Blocks[0].Kind = "mystery" }}, {"heading", func(s *snapshot) { s.Blocks[0].HeadingLevel = 7 }}, {"markdown mismatch", func(s *snapshot) { s.Markdown = "Different" }}, {"reconstruction", func(s *snapshot) { s.Blocks[0].Source = "## Wrong" }}} {
		t.Run(tc.name, func(t *testing.T) {
			var copy snapshot
			_ = json.Unmarshal([]byte(jsonString(snap)), &copy)
			tc.mutate(&copy)
			bad := Row{"blockDocumentJSON": jsonString(copy), "markdown": md, "blockSchemaVersion": 1, "blockRevision": 2}
			if e := validateSnapshot(bad); e == nil {
				t.Fatal("invalid snapshot accepted")
			}
		})
	}
}
func TestPathCompatibility(t *testing.T) {
	d := Row{"id": "00000000-0000-0000-0000-0123456789AB", "title": "Café Notes", "path": nil}
	if got := pcktPath(d, false); got != "/cafe-notes-56789ab" {
		t.Fatal(got)
	}
	if got := offprintPath(d, "3mkey"); got != "/a/3mkey-cafe-notes" {
		t.Fatal(got)
	}
	d["path"] = "/native-psbyfky"
	if pcktPath(d, true) != "/native-psbyfky" {
		t.Fatal("changed published path")
	}
	d["path"] = "/a/old-custom-slug"
	if offprintPath(d, "new") != "/a/new-custom-slug" {
		t.Fatal("lost custom slug")
	}
	d["path"] = "/saved-56789ab"
	if pcktPath(d, false) != "/saved-56789ab" {
		t.Fatal("duplicate discriminator")
	}
}
func TestImporterNativeRoundTrips(t *testing.T) {
	md := "# Heading\n\nA **bold** and *italic* [link](https://example.com).\n\n> Quote\n\n1. First\n2. Second\n\n- [x] Task\n\n```go\nfmt.Println(1)\n```\n\n---\n\n@[embed](https://example.com/embed)"
	for _, host := range []string{"leaflet", "offprint", "pckt"} {
		t.Run(host, func(t *testing.T) {
			native, e := anypub.BuildArticleNativeContent(anypub.NativeContentInput{Host: host, Markdown: md, Blocks: markdownBlocks(md, "")})
			if e != nil {
				t.Fatal(e)
			}
			imported, images := importBody(Row{"content": native.Content}, nil)
			if imported != md || len(images) != 0 {
				t.Fatalf("round trip:\n%s\nwant:\n%s", imported, md)
			}
		})
	}
}
func TestImporterOffloadAndImages(t *testing.T) {
	blob := Row{"$type": "blob", "ref": Row{"$link": "cid"}, "mimeType": "image/png", "size": 42}
	image := Row{"$type": "blog.pckt.block.image", "attrs": Row{"blob": blob, "alt": "Alt", "aspectRatio": Row{"width": 640, "height": 480}}}
	body := jsonString([]any{Row{"$type": "blog.pckt.block.heading", "plaintext": "Heading", "level": 2}, image})
	md, images := importBody(Row{"content": Row{"$type": "blog.pckt.content", "blob": blob}}, []byte(body))
	if md != "## Heading\n\n![Alt](anypub-import-blob://cid)" || len(images) != 1 || images[0].Width != 640 {
		t.Fatalf("%q %#v", md, images)
	}
	md, _ = importBody(Row{"content": Row{"text": Row{"textBlob": blob}}}, []byte("# Markdown\n\nBody"))
	if md != "# Markdown\n\nBody" {
		t.Fatal(md)
	}
	md, _ = importBody(Row{"textContent": "First\nSecond"}, nil)
	if md != "First\n\nSecond" {
		t.Fatal(md)
	}
}
