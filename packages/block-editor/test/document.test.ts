import { describe, expect, it } from "vitest";
import {
  StaleBlockDocumentError,
  importMarkdownDocument,
  parseBlockDocument,
  reviseBlockDocument,
  reviseMarkdownDocument,
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
});
