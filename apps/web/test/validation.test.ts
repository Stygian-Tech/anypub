import { describe, expect, it } from "vitest";
import {
  compactMarkdownBlocks,
  isEmptyListMarkdownBlock,
  joinMarkdownBlocks,
  moveMarkdownBlock,
  moveMarkdownBlockToInsertion,
  orderedListOrdinalAt,
  outdentEmptyListMarkdownBlock,
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
    expect(summarizeMarkdownBlock("---")).toEqual({ kind: "thematic-break" });
  });

  it("parses and preserves thematic break blocks", () => {
    const markdown = "Above\n\n---\n\nBelow";

    expect(parseMarkdownBlocks(markdown)).toEqual([
      { kind: "paragraph", source: "Above" },
      { kind: "thematic-break", source: "---" },
      { kind: "paragraph", source: "Below" },
    ]);
    expect(joinMarkdownBlocks(parseMarkdownBlocks(markdown))).toBe(markdown);
  });

  it("parses blocks into typed formatting records", () => {
    expect(parseMarkdownBlocks("## Heading\n\n3. Ordered\n4. Next\n\nBody")).toEqual([
      { kind: "heading", source: "## Heading", headingLevel: 2 },
      { kind: "ordered-list", source: "3. Ordered", listLevel: 0, listStart: 3 },
      { kind: "ordered-list", source: "4. Next", listLevel: 0, listStart: 4 },
      { kind: "paragraph", source: "Body" },
    ]);
  });

  it("preserves spaces while parsing an actively edited block", () => {
    expect(parseMarkdownBlock("Body copy ")).toEqual({ kind: "paragraph", source: "Body copy " });
    expect(parseMarkdownBlock("## Heading ")).toEqual({
      kind: "heading",
      source: "## Heading ",
      headingLevel: 2,
    });
    expect(joinMarkdownBlocks([parseMarkdownBlock("Body copy ")])).toBe("Body copy");
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

  it("keeps soft line breaks inside one list item block", () => {
    const markdown = "- First line\ncontinuation line\n- Next item";

    expect(parseMarkdownBlocks(markdown)).toEqual([
      { kind: "unordered-list", source: "- First line\ncontinuation line", listLevel: 0 },
      { kind: "unordered-list", source: "- Next item", listLevel: 0 },
    ]);
    expect(joinMarkdownBlocks(parseMarkdownBlocks(markdown))).toBe(markdown);
  });

  it("keeps soft line breaks inside one heading block", () => {
    expect(parseMarkdownBlock("## First line\nsecond line")).toEqual({
      kind: "heading",
      source: "## First line\nsecond line",
      headingLevel: 2,
    });
  });

  it("preserves block types when joining adjacent mixed lists", () => {
    const markdown = "- Bullet\n\t- Nested bullet\n\n1. Numbered\n\t1. Nested numbered\n\n- Final bullet";
    const parsed = parseMarkdownBlocks(markdown);

    expect(joinMarkdownBlocks(parsed)).toBe(markdown);
    expect(parseMarkdownBlocks(joinMarkdownBlocks(parsed))).toEqual(parsed);
  });

  it("rewrites list indentation through typed list levels", () => {
    expect(setMarkdownBlockListLevel(parseMarkdownBlock("- Child"), 1)).toEqual({
      kind: "unordered-list",
      source: "\t- Child",
      listLevel: 1,
    });
  });

  it("dedents empty list items and converts top-level items to text blocks", () => {
    const nested = parseMarkdownBlock("\t\t- ");
    const topLevel = parseMarkdownBlock("- ");

    expect(isEmptyListMarkdownBlock(nested)).toBe(true);
    expect(outdentEmptyListMarkdownBlock(nested)).toEqual({
      kind: "unordered-list",
      source: "\t- ",
      listLevel: 1,
    });
    expect(outdentEmptyListMarkdownBlock(topLevel)).toEqual({ kind: "empty", source: "" });
    expect(isEmptyListMarkdownBlock(parseMarkdownBlock("- Content"))).toBe(false);
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

  it("moves blocks to explicit insertion gaps", () => {
    expect(moveMarkdownBlockToInsertion(["A", "B", "C"], 0, 3)).toEqual(["B", "C", "A"]);
    expect(moveMarkdownBlockToInsertion(["A", "B", "C"], 2, 1)).toEqual(["A", "C", "B"]);
  });

  it("numbers ordered-list siblings independently from nested descendants", () => {
    const blocks = parseMarkdownBlocks("1. First\n2. Second\n\t3. Nested\n4. Third");

    expect(blocks.map((block, index) => block.kind === "ordered-list" ? orderedListOrdinalAt(blocks, index) : null)).toEqual([
      1,
      2,
      1,
      3,
    ]);
  });

  it("moves a parent list item with its descendants to the final gap", () => {
    const blocks = parseMarkdownBlocks("- Parent\n\t- Child\n- Sibling");

    expect(moveMarkdownBlockToInsertion(blocks, 0, blocks.length)).toEqual([
      { kind: "unordered-list", source: "- Sibling", listLevel: 0 },
      { kind: "unordered-list", source: "- Parent", listLevel: 0 },
      { kind: "unordered-list", source: "\t- Child", listLevel: 1 },
    ]);
    expect(moveMarkdownBlockToInsertion(blocks, 0, 1)).toEqual(blocks);
  });

  it("moves a child subtree independently and breaks it out of its parent", () => {
    const blocks = parseMarkdownBlocks("- Parent\n\t- First child\n\t\t- Grandchild\n\t- Second child\n- Sibling");

    expect(moveMarkdownBlockToInsertion(blocks, 1, blocks.length, { targetListLevel: 0 })).toEqual([
      { kind: "unordered-list", source: "- Parent", listLevel: 0 },
      { kind: "unordered-list", source: "\t- Second child", listLevel: 1 },
      { kind: "unordered-list", source: "- Sibling", listLevel: 0 },
      { kind: "unordered-list", source: "- First child", listLevel: 0 },
      { kind: "unordered-list", source: "\t- Grandchild", listLevel: 1 },
    ]);
  });

  it("changes list depth when dropped at the current insertion gap", () => {
    const blocks = parseMarkdownBlocks("- Parent\n\t- Child\n\t\t- Grandchild\n- Sibling");

    expect(moveMarkdownBlockToInsertion(blocks, 1, 2, { targetListLevel: 0 })).toEqual([
      { kind: "unordered-list", source: "- Parent", listLevel: 0 },
      { kind: "unordered-list", source: "- Child", listLevel: 0 },
      { kind: "unordered-list", source: "\t- Grandchild", listLevel: 1 },
      { kind: "unordered-list", source: "- Sibling", listLevel: 0 },
    ]);
    expect(moveMarkdownBlockToInsertion(blocks, 3, 3, { targetListLevel: 1 })).toEqual([
      { kind: "unordered-list", source: "- Parent", listLevel: 0 },
      { kind: "unordered-list", source: "\t- Child", listLevel: 1 },
      { kind: "unordered-list", source: "\t\t- Grandchild", listLevel: 2 },
      { kind: "unordered-list", source: "\t- Sibling", listLevel: 1 },
    ]);
  });

  it("splits paragraph blocks at the cursor", () => {
    expect(splitMarkdownBlockAtCursor(parseMarkdownBlock("First second"), 6)).toEqual([
      { kind: "paragraph", source: "First " },
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
