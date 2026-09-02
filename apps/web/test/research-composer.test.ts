import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { BlockDocumentRenderer, importMarkdownDocument, parseBlockDocument } from "@stygian/markdown-editor";
import { describe, expect, it } from "vitest";
import {
  appendResearchToDraft,
  materialFromMargin,
  materialFromSemble,
  researchMarkdown,
  type ResearchPostParts,
} from "@/lib/research-composer";
import type { Draft } from "@/lib/types";

const allParts: ResearchPostParts = { quote: true, link: true, comment: true };

describe("research post materials", () => {
  it("uses a Semble note without duplicating the source description", () => {
    expect(materialFromSemble({
      uri: "at://did:plc:writer/network.cosmik.card/card",
      title: "  Source article  ",
      url: "https://example.com/article",
      note: " My response ",
      description: "Source summary",
      author: "  A. Writer ",
    })).toEqual({
      title: "Source article",
      sourceURL: "https://example.com/article",
      comment: "My response",
      author: "A. Writer",
    });
  });

  it("keeps Margin quotes and comments separate and falls back to the source host", () => {
    expect(materialFromMargin({
      uri: "at://did:plc:writer/at.margin.note/note",
      motivation: "highlighting",
      source: "https://www.example.com/essay",
      quote: " First line\r\nSecond line ",
      body: "My response",
      tags: ["do-not-import"],
      createdAt: "2026-09-01T00:00:00.000Z",
    })).toEqual({
      title: "example.com",
      sourceURL: "https://www.example.com/essay",
      quote: "First line\nSecond line",
      comment: "My response",
    });
  });

  it("supports a standalone note without inventing a quote or source link", () => {
    const material = materialFromSemble({
      uri: "at://did:plc:writer/network.cosmik.card/note",
      note: "A standalone thought",
    });
    expect(material.title).toBe("Research note");
    expect(material.sourceURL).toBeUndefined();
    expect(researchMarkdown(material, allParts)).toBe("A standalone thought");
  });
});

describe("research Markdown", () => {
  it("inserts multiline quotations, linked attribution, and a separate comment", () => {
    expect(researchMarkdown({
      title: "An essay",
      sourceURL: "https://example.com/essay",
      quote: "First paragraph\n\nSecond paragraph",
      comment: "My response\nA second line",
      author: "A Writer",
    }, allParts)).toBe(
      "> First paragraph\n>\n> Second paragraph\n\n[An essay](https://example.com/essay) — A Writer\n\nMy response\nA second line",
    );
  });

  it("includes only the selected parts and skips empty content", () => {
    const material = { title: "Source", sourceURL: "https://example.com/", quote: "A quotation", comment: "A comment" };
    expect(researchMarkdown(material, { quote: true, link: false, comment: false })).toBe("> A quotation");
    expect(researchMarkdown(material, { quote: false, link: true, comment: false })).toBe("[Source](https://example.com/)");
    expect(researchMarkdown(material, { quote: false, link: false, comment: true })).toBe("A comment");
    expect(researchMarkdown(material, { quote: false, link: false, comment: false })).toBe("");
    expect(researchMarkdown({ title: "Source", quote: " \n ", comment: " " }, allParts)).toBe("");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<h1>Hello</h1>",
    "file:///etc/passwd",
    "/relative-path",
    "https://example.com/\ninjected",
    "https://example.com/\u0000injected",
  ])("does not turn unsafe source %j into a link", (sourceURL) => {
    const material = materialFromSemble({ uri: "card", title: "Source", url: sourceURL, note: "Keep the note" });
    expect(material.sourceURL).toBeUndefined();
    expect(researchMarkdown({ ...material, sourceURL }, allParts)).toBe("Keep the note");
  });

  it("encodes URL whitespace and punctuation without allowing Markdown breakout", () => {
    expect(researchMarkdown({
      title: "Source",
      sourceURL: "https://example.com/a b_(c)?q=[one]",
    }, allParts)).toBe("[Source](https://example.com/a%20b_%28c%29?q=%5Bone%5D)");
  });

  it("renders imported punctuation literally without creating links, images, or formatting", () => {
    const quote = "[A link](https://evil.example/) and **bold**";
    const comment = "![Tracking image](https://evil.example/pixel)\n# A literal heading";
    const markdown = researchMarkdown({ title: "Source", quote, comment }, allParts);
    const document = importMarkdownDocument(markdown);
    expect(document.blocks.map((block) => block.kind)).toEqual(["quote", "paragraph"]);
    const { container } = render(createElement(BlockDocumentRenderer, { document }));
    expect(container.textContent).toContain(quote);
    expect(container.textContent).toContain("![Tracking image](https://evil.example/pixel)");
    expect(container.textContent).toContain("# A literal heading");
    expect(container.querySelector("a, img, strong, em, h1")).toBeNull();
  });

  it("renders a source title with punctuation as one safe attribution link", () => {
    const document = importMarkdownDocument(researchMarkdown({
      title: "Source [with brackets] and *literal stars*",
      sourceURL: "https://example.com/a_(b)",
      author: "A. Writer",
    }, allParts));
    render(createElement(BlockDocumentRenderer, { document }));
    expect(screen.getByRole("link", { name: "Source [with brackets] and *literal stars*" })).toHaveAttribute(
      "href", "https://example.com/a_%28b%29",
    );
    expect(screen.getByText(/A\. Writer/)).toBeInTheDocument();
  });
});

describe("appending research to a draft", () => {
  const draft: Draft = {
    id: "draft-id",
    accountDID: "did:plc:writer",
    publicationURI: "at://did:plc:writer/site.standard.publication/blog",
    publicationURL: "https://writer.example",
    title: "Work in progress",
    path: "/custom-path",
    excerpt: "Existing excerpt",
    tags: ["original"],
    markdown: "# Existing heading\n\nUnsaved local text\n\n![Photo](anypub-asset://asset-id)",
    plaintext: "Existing heading\nUnsaved local text\nPhoto",
    status: "draft",
    blockRevision: 8,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  it("preserves existing content, assets, and post metadata in a consistent block document", () => {
    const appended = appendResearchToDraft(draft, "> Research quote\n\n[Source](https://example.com/)");
    expect(appended.markdown).toBe(`${draft.markdown}\n\n> Research quote\n\n[Source](https://example.com/)`);
    expect(appended).toMatchObject({
      id: draft.id,
      accountDID: draft.accountDID,
      publicationURI: draft.publicationURI,
      publicationURL: draft.publicationURL,
      title: draft.title,
      path: draft.path,
      excerpt: draft.excerpt,
      tags: draft.tags,
      status: "draft",
      createdAt: draft.createdAt,
      blockSchemaVersion: 1,
      blockRevision: 9,
    });
    const document = parseBlockDocument(JSON.parse(appended.blockDocumentJSON!));
    expect(document.markdown).toBe(appended.markdown);
    expect(document.revision).toBe(appended.blockRevision);
    expect(document.blocks.find((block) => block.kind === "image")).toMatchObject({ url: "anypub-asset://asset-id" });
    expect(draft.markdown).not.toContain("Research quote");
  });

  it("rebuilds a stale snapshot from canonical Markdown and normalizes it consistently", () => {
    const appended = appendResearchToDraft({
      ...draft,
      markdown: "First paragraph\r\n\r\n\r\nSecond paragraph\n",
      blockDocumentJSON: JSON.stringify(importMarkdownDocument("Stale content")),
    }, "A comment");
    const document = parseBlockDocument(JSON.parse(appended.blockDocumentJSON!));
    expect(document.markdown).toBe("First paragraph\n\nSecond paragraph\n\nA comment");
    expect(appended.markdown).toBe(document.markdown);
    expect(appended.plaintext).toContain("A comment");
  });

  it("starts an empty draft without leading whitespace and ignores empty selections", () => {
    expect(appendResearchToDraft({ ...draft, markdown: "", blockRevision: undefined }, "> Quote")).toMatchObject({
      markdown: "> Quote",
      blockRevision: 1,
    });
    expect(appendResearchToDraft(draft, "  \n")).toBe(draft);
  });
});
