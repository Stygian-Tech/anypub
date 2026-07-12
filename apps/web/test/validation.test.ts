import { describe, expect, it } from "vitest";
import {
  compactMarkdownBlocks,
  joinMarkdownBlocks,
  moveMarkdownBlock,
  parseMarkdownBlock,
  parseMarkdownBlocks,
  setMarkdownBlockListLevel,
  splitMarkdownBlockAtCursor,
  splitMarkdownBlocks,
  summarizeMarkdownBlock,
} from "@/lib/markdown-blocks";
import { markdownToPlaintext, validateDraft } from "@/lib/validation";

describe("draft validation", () => {
  it("requires title, publication, and markdown body", () => {
    const result = validateDraft({
      title: "",
      publicationURI: "",
      markdown: "",
      path: "missing-leading-slash",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.title).toBeTruthy();
    expect(result.errors.publicationURI).toBeTruthy();
    expect(result.errors.markdown).toBeTruthy();
    expect(result.errors.path).toBeTruthy();
  });

  it("accepts a valid draft", () => {
    const result = validateDraft({
      title: "Post",
      publicationURI: "at://did:plc:example/site.standard.publication/abc",
      markdown: "Body",
      path: "/post",
    });

    expect(result.valid).toBe(true);
  });
});

describe("markdown block helpers", () => {
  it("splits markdown into block sections and individual list items", () => {
    const markdown = "# Title\n\nBody copy\n\n- One\n- Two";
    const blocks = splitMarkdownBlocks(markdown);

    expect(blocks).toEqual(["# Title", "Body copy", "- One", "- Two"]);
    expect(joinMarkdownBlocks(blocks)).toBe(markdown);
  });

  it("compacts empty blocks when joining markdown", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
    expect(compactMarkdownBlocks(["# Title", "   ", "Body"])).toEqual(["# Title", "Body"]);
    expect(joinMarkdownBlocks(["# Title", "   ", "Body"])).toBe("# Title\n\nBody");
  });

  it("summarizes common block styles", () => {
    expect(summarizeMarkdownBlock("## Heading")).toEqual({ kind: "heading", headingLevel: 2 });
    expect(summarizeMarkdownBlock("> Pull quote")).toEqual({ kind: "quote" });
    expect(summarizeMarkdownBlock("- One\n- Two")).toEqual({ kind: "unordered-list" });
    expect(summarizeMarkdownBlock("1. One\n2. Two")).toEqual({ kind: "ordered-list" });
  });

  it("parses blocks into typed formatting records", () => {
    expect(parseMarkdownBlocks("## Heading\n\n3. Ordered\n4. Next\n\nBody")).toEqual([
      { kind: "heading", source: "## Heading", headingLevel: 2 },
      { kind: "ordered-list", source: "3. Ordered", listLevel: 0, listStart: 3 },
      { kind: "ordered-list", source: "4. Next", listLevel: 0, listStart: 4 },
      { kind: "paragraph", source: "Body" },
    ]);
  });

  it("preserves nested list item levels when parsing and joining", () => {
    const markdown = "- Parent\n\t- Child\n- Sibling";

    expect(splitMarkdownBlocks(markdown)).toEqual(["- Parent", "\t- Child", "- Sibling"]);
    expect(parseMarkdownBlocks(markdown)).toEqual([
      { kind: "unordered-list", source: "- Parent", listLevel: 0 },
      { kind: "unordered-list", source: "\t- Child", listLevel: 1 },
      { kind: "unordered-list", source: "- Sibling", listLevel: 0 },
    ]);
    expect(joinMarkdownBlocks(parseMarkdownBlocks(markdown))).toBe(markdown);
  });

  it("rewrites list indentation through typed list levels", () => {
    expect(setMarkdownBlockListLevel(parseMarkdownBlock("- Child"), 1)).toEqual({
      kind: "unordered-list",
      source: "\t- Child",
      listLevel: 1,
    });
  });

  it("moves blocks while compacting empty blocks", () => {
    expect(moveMarkdownBlock(["# Title", "   ", "- One", "- Two"], 2, 0)).toEqual([
      "- Two",
      "# Title",
      "- One",
    ]);
    expect(joinMarkdownBlocks(["1. One", "2. Two", "Paragraph"])).toBe("1. One\n2. Two\n\nParagraph");
  });

  it("moves list blocks into nested levels", () => {
    expect(moveMarkdownBlock(parseMarkdownBlocks("- Parent\n\t- Child\n- Sibling"), 2, 1, { targetListLevel: 1 })).toEqual([
      { kind: "unordered-list", source: "- Parent", listLevel: 0 },
      { kind: "unordered-list", source: "\t- Sibling", listLevel: 1 },
      { kind: "unordered-list", source: "\t- Child", listLevel: 1 },
    ]);
  });

  it("splits paragraph blocks at the cursor", () => {
    expect(splitMarkdownBlockAtCursor(parseMarkdownBlock("First second"), 6)).toEqual([
      { kind: "paragraph", source: "First" },
      { kind: "paragraph", source: "second" },
    ]);
  });

  it("splits unordered list blocks into sibling list item blocks", () => {
    expect(splitMarkdownBlockAtCursor(parseMarkdownBlock("\t- First second"), 8)).toEqual([
      { kind: "unordered-list", source: "\t- First", listLevel: 1 },
      { kind: "unordered-list", source: "\t-  second", listLevel: 1 },
    ]);
  });

  it("splits ordered list blocks using the next item number", () => {
    expect(splitMarkdownBlockAtCursor(parseMarkdownBlock("3. Ordered item"), 15)).toEqual([
      { kind: "ordered-list", source: "3. Ordered item", listLevel: 0, listStart: 3 },
      { kind: "ordered-list", source: "4. ", listLevel: 0, listStart: 4 },
    ]);
  });
});

describe("markdownToPlaintext", () => {
  it("preserves text while removing markdown syntax", () => {
    expect(markdownToPlaintext("# Title\n\nA [link](https://example.com) and **bold** text.")).toBe(
      "Title\nA link and bold text.",
    );
  });

  it("renders Markdown sections on separate lines", () => {
    expect(markdownToPlaintext("## Intro\n\n- First point\n- Second point\n\n> Closing note")).toBe(
      ["Intro", "First point", "Second point", "Closing note"].join("\n"),
    );
  });
});
