import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownBlockEditor } from "@anypub/block-editor";

describe("block editor list interactions", () => {
  it("backs an empty top-level bullet out into a text block", () => {
    const onChange = vi.fn();
    render(
      <MarkdownBlockEditor
        value={"# Heading\n\n- "}
        invalid={false}
        onChange={onChange}
      />,
    );

    const previews = screen.getAllByTestId("markdown-block-preview");
    fireEvent.click(previews[1]!);
    const editor = screen.getByTestId("markdown-block-textarea");
    expect(editor).toHaveValue("-");

    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(onChange).toHaveBeenLastCalledWith("# Heading");
    expect(screen.queryByTestId("markdown-editing-list-marker")).not.toBeInTheDocument();
    expect(screen.getByTestId("markdown-block-textarea")).toHaveValue("");
  });

  it("keeps syntax highlighting visible while a fenced code block is active", () => {
    render(
      <MarkdownBlockEditor
        value={"```typescript\nconst answer = 42;\n```"}
        invalid={false}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("markdown-block-preview"));

    expect(screen.getByTestId("syntax-highlighted-code")).toHaveAttribute("data-highlight-language", "typescript");
    expect(screen.getByText("const", { selector: ".token.keyword" })).toBeInTheDocument();
    expect(screen.getByTestId("markdown-block-textarea")).toBeInTheDocument();
  });

  it("turns a pasted standalone URL into a link whose text is the URL", () => {
    const onChange = vi.fn();
    render(
      <MarkdownBlockEditor
        value={"Paste here"}
        invalid={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("markdown-block-preview"));
    const editor = screen.getByTestId("markdown-block-textarea") as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

    fireEvent.paste(editor, {
      clipboardData: { getData: () => "https://example.com/article" },
    });

    expect(onChange).toHaveBeenLastCalledWith("Paste here[https://example.com/article](https://example.com/article)");
  });
});
