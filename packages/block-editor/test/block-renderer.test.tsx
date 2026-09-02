import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseMarkdownBlock } from "../src/model";
import { MarkdownBlockPreview } from "../src/react/block-renderer";

describe("Markdown block preview", () => {
  it("renders escaped quote and comment Markdown as literal text", () => {
    const source = String.raw`\[label\]\(https://example.com\) \!\[image\]\(https://example.com/image.png\) \*stars\* \\path \a`;
    for (const blockSource of [source, `> ${source}`]) {
      const markup = renderToStaticMarkup(<MarkdownBlockPreview block={parseMarkdownBlock(blockSource)} />);

      expect(markup.replace(/<[^>]+>/g, "")).toBe(String.raw`[label](https://example.com) ![image](https://example.com/image.png) *stars* \path \a`);
      expect(markup).not.toMatch(/<(?:a|em|strong|img)\b/);
    }
  });

  it("keeps escaped punctuation inside source link labels and destinations", () => {
    const markup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock(String.raw`[Source \[notes\] \*draft\*](https://example.com/notes\(1\))`)} />,
    );

    expect(markup).toContain('href="https://example.com/notes(1)"');
    expect(markup).toContain("Source [notes] *draft*</a>");
  });

  it("ignores escaped style delimiters while preserving code backslashes", () => {
    const markup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock(String.raw`**café \*\*quoted\*\* 😀** *literal \*star\** and ` + "`\\*code\\*`")} />,
    );

    expect(markup).toContain('<strong class="font-semibold">café **quoted** 😀</strong>');
    expect(markup).toContain('<em class="italic">literal *star*</em>');
    expect(markup).toContain(String.raw`>\*code\*</code>`);
  });

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

    expect(markup.replace(/<[^>]+>/g, "")).toBe("const first = 1;\n\nconst second = 2;");
    expect(markup).toContain('data-highlight-language="typescript"');
    expect(markup).toContain('class="token keyword"');
    expect(markup).toContain('class="token number"');
  });

  it("supports punctuated language aliases and falls back safely for unknown languages", () => {
    const cppMarkup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock("```c++\nauto answer = 42;\n```")} />,
    );
    const unknownMarkup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock("```not-a-language\nplain value\n```")} />,
    );

    expect(cppMarkup).toContain('data-language="c++"');
    expect(cppMarkup).toContain('data-highlight-language="cpp"');
    expect(unknownMarkup).toContain('data-highlight-language="plaintext"');
    expect(unknownMarkup).toContain("plain value");
  });

  it("renders standard images, custom image resolvers, and embed choices", () => {
    const image = parseMarkdownBlock("![Diagram](custom-asset://diagram)");
    const imageMarkup = renderToStaticMarkup(
      <MarkdownBlockPreview
        block={image}
        resolveImageURL={(url) => url === "custom-asset://diagram" ? "/api/assets/diagram/content" : undefined}
      />,
    );
    const remoteImageMarkup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock("![Remote](https://cdn.example.com/remote.png)")} />,
    );
    const embedMarkup = renderToStaticMarkup(
      <MarkdownBlockPreview block={parseMarkdownBlock("@[embed](https://example.com/article)")} />,
    );

    expect(imageMarkup).toContain('src="/api/assets/diagram/content"');
    expect(imageMarkup).toContain('alt="Diagram"');
    expect(remoteImageMarkup).toContain('src="https://cdn.example.com/remote.png"');
    expect(embedMarkup).toContain("Embedded link");
    expect(embedMarkup).toContain("https://example.com/article");
  });
});
