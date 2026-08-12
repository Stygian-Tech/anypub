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
});
