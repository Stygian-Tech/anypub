import { describe, expect, it } from "vitest";
import {
  StaleBlockDocumentError,
  importMarkdownDocument,
  parseBlockDocument,
  reviseBlockDocument,
  reviseMarkdownDocument,
  shouldInsertCodeBlockSoftBreak,
} from "../src/model";

const ids = () => {
  let value = 0;
  return () => `test-${++value}`;
};

describe("block document snapshots", () => {
  it("round-trips Markdown without exposing IDs in the serialized value", () => {
    const document = importMarkdownDocument("# Title\n\nBody\n\n- Item", { createID: ids() });
    expect(document.markdown).toBe("# Title\n\nBody\n\n- Item");
    expect(document.blocks.map((block) => block.id)).toEqual(["test-1", "test-2", "test-3"]);
    expect(parseBlockDocument(document)).toEqual(document);
  });

  it("increments revisions atomically", () => {
    const document = importMarkdownDocument("Body", { revision: 4, createID: ids() });
    const revised = reviseBlockDocument(document, [{ ...document.blocks[0]!, source: "Changed" }]);
    expect(revised).toMatchObject({ revision: 5, markdown: "Changed" });
  });

  it("preserves stable block IDs while revising Markdown", () => {
    const createID = ids();
    const document = importMarkdownDocument("First\n\nSecond", { createID });
    const revised = reviseMarkdownDocument(document, "Changed\n\nSecond\n\nThird", 0, createID);
    expect(revised.blocks.map((block) => block.id)).toEqual(["test-1", "test-2", "test-3"]);
    expect(revised.revision).toBe(1);
  });

  it("rejects stale updates and divergent Markdown", () => {
    const document = importMarkdownDocument("Body", { revision: 2, createID: ids() });
    expect(() => reviseBlockDocument(document, document.blocks, 1)).toThrow(StaleBlockDocumentError);
    expect(() => parseBlockDocument({ ...document, markdown: "Different" })).toThrow(/does not match/);
  });

  it("preserves fenced code blocks containing blank lines", () => {
    const markdown = "```swift\nlet first = 1\n\nlet second = 2\n```";
    const document = importMarkdownDocument(markdown, { createID: ids() });

    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]).toMatchObject({
      kind: "code",
      language: "swift",
      source: markdown,
    });
    expect(document.markdown).toBe(markdown);
  });

  it("keeps Enter inside open code fences and exits after the closing fence", () => {
    const open = importMarkdownDocument("```swift\nlet value = 1", { createID: ids() }).blocks[0]!;
    const closed = importMarkdownDocument("```swift\nlet value = 1\n```", { createID: ids() }).blocks[0]!;

    expect(shouldInsertCodeBlockSoftBreak(open, open.source.length)).toBe(true);
    expect(shouldInsertCodeBlockSoftBreak(closed, closed.source.indexOf("let value"))).toBe(true);
    expect(shouldInsertCodeBlockSoftBreak(closed, closed.source.length)).toBe(false);
  });

  it("round-trips uploaded images and embedded links as typed blocks", () => {
    const assetID = "d9428888-122b-11e1-b85c-61cd3cbb3210";
    const markdown = `![Diagram](anypub-asset://${assetID})\n\n@[embed](https://example.com/article)`;
    const document = importMarkdownDocument(markdown, { createID: ids() });

    expect(document.blocks[0]).toMatchObject({ kind: "image", assetID, alt: "Diagram" });
    expect(document.blocks[1]).toMatchObject({ kind: "embed", url: "https://example.com/article" });
    expect(document.markdown).toBe(markdown);
  });
});
