import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseMarkdownBlock } from "../src/model";
import { MarkdownBlockPreview } from "../src/react/block-renderer";

describe("Markdown block preview", () => {
  it("renders italics, strikethrough, and underline extensions", () => {
    const markup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock("*first* _second_ ~~removed~~ ++underlined++")} />,
    );

    expect(markup).toContain('<em class="italic">first</em>');
    expect(markup).toContain('<em class="italic">second</em>');
    expect(markup).toContain('<del class="line-through">removed</del>');
    expect(markup).toContain('<u class="underline underline-offset-2">underlined</u>');
  });

  it("renders every line in a fenced code block", () => {
    const markup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock("```ts\nconst first = 1;\n\nconst second = 2;\n```")} />,
    );

    expect(markup).toContain("const first = 1;\n\nconst second = 2;");
  });
});
