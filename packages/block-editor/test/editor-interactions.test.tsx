import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownBlockEditor, type BlockEditorHandle } from "../src";

describe("Markdown block editor interactions", () => {
  it("backs an empty top-level bullet out into a text block", () => {
    const onChange = vi.fn();
    render(
      <MarkdownBlockEditor value={"# Heading\n\n- "} onChange={onChange} />,
    );

    fireEvent.click(screen.getAllByTestId("markdown-block-preview")[1]!);
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
    render(<MarkdownBlockEditor value="Paste here" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("markdown-block-preview"));
    const editor = screen.getByTestId("markdown-block-textarea") as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

    fireEvent.paste(editor, {
      clipboardData: { getData: () => "https://example.com/article" },
    });

    expect(onChange).toHaveBeenLastCalledWith("Paste here[https://example.com/article](https://example.com/article)");
  });

  it("sends pasted images to the consumer handler after the active block", () => {
    const onImageFiles = vi.fn();
    render(
      <MarkdownBlockEditor
        value={"First\n\nSecond"}
        onChange={() => undefined}
        onImageFiles={onImageFiles}
      />,
    );
    fireEvent.click(screen.getAllByTestId("markdown-block-preview")[0]!);
    const file = new File(["image"], "pasted.png", { type: "image/png" });

    fireEvent.paste(screen.getByTestId("markdown-block-textarea"), {
      clipboardData: { files: [file], getData: () => "" },
    });

    expect(onImageFiles).toHaveBeenCalledWith([file], 1);
  });

  it("shows a drop target and sends dropped images to the requested insertion point", () => {
    const onImageFiles = vi.fn();
    render(
      <MarkdownBlockEditor
        value={"First\n\nSecond"}
        onChange={() => undefined}
        onImageFiles={onImageFiles}
      />,
    );
    const editor = screen.getByTestId("markdown-block-editor");
    const file = new File(["image"], "dropped.webp", { type: "image/webp" });
    const dataTransfer = { files: [file], dropEffect: "none" };

    fireEvent.dragOver(editor, { dataTransfer });
    expect(screen.getByTestId("markdown-image-drop-overlay")).toHaveTextContent("Drop images to add them");

    fireEvent.drop(editor, { dataTransfer });

    expect(onImageFiles).toHaveBeenCalledWith([file], 2);
    expect(screen.queryByTestId("markdown-image-drop-overlay")).not.toBeInTheDocument();
  });

  it("inserts a custom image at an explicit position and resolves its preview URL", () => {
    const onChange = vi.fn();
    const ref = createRef<BlockEditorHandle>();
    render(
      <MarkdownBlockEditor
        ref={ref}
        value={"First\n\nSecond"}
        onChange={onChange}
        resolveImageURL={(url) => url === "custom-asset://preview" ? "/api/assets/preview/content" : undefined}
      />,
    );

    act(() => ref.current?.insertBlock("![Preview](custom-asset://preview)", 1));
    expect(onChange).toHaveBeenLastCalledWith(
      "First\n\n![Preview](custom-asset://preview)\n\nSecond",
    );
    expect(screen.getByRole("img", { name: "Preview" })).toHaveAttribute(
      "src",
      "/api/assets/preview/content",
    );
  });

  it("exposes touch-friendly move up and down alternatives", () => {
    const onChange = vi.fn();
    render(<MarkdownBlockEditor value={"First\n\nSecond"} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Move block 1" }));
    expect(screen.getByRole("button", { name: "Move block 1 up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move block 1 down" }));

    expect(onChange).toHaveBeenLastCalledWith("Second\n\nFirst");
  });
});
