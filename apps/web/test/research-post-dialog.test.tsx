import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ResearchPostDialog } from "@/components/cms/research-post-dialog";
import type { Draft, Publication } from "@/lib/types";

const publication: Publication = {
  id: "publication-one",
  accountDID: "did:plc:writer",
  uri: "at://did:plc:writer/site.standard.publication/field-notes",
  name: "Field Notes",
  url: "https://field-notes.example",
  syncedAt: "2026-09-01T12:00:00.000Z",
};

const otherPublication: Publication = {
  ...publication,
  id: "publication-two",
  uri: "at://did:plc:writer/site.standard.publication/workbench",
  name: "Workbench",
  url: "https://workbench.example",
};

const draft: Draft = {
  id: "draft-one",
  accountDID: publication.accountDID,
  publicationURI: publication.uri,
  publicationURL: publication.url,
  title: "An existing essay",
  tags: [],
  markdown: "An earlier paragraph.",
  plaintext: "An earlier paragraph.",
  status: "draft",
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const otherDraft: Draft = { ...draft, id: "draft-two", title: "Another essay" };

const material = {
  title: "A source worth discussing",
  sourceURL: "https://example.org/essay",
  quote: "A highlighted passage from the source",
  comment: "My response to the central claim",
  author: "A. Writer",
};

function showDialog(overrides: Partial<ComponentProps<typeof ResearchPostDialog>> = {}) {
  const onSubmit = vi.fn<ComponentProps<typeof ResearchPostDialog>["onSubmit"]>().mockResolvedValue(true);
  const onOpenChange = vi.fn();
  const props = {
    material,
    drafts: [draft, otherDraft],
    publications: [publication, otherPublication],
    onSubmit,
    onOpenChange,
    ...overrides,
  };
  const { rerender } = render(<ResearchPostDialog {...props} />);
  return {
    onSubmit: props.onSubmit,
    onOpenChange: props.onOpenChange,
    updateProps: (next: Partial<ComponentProps<typeof ResearchPostDialog>>) => rerender(<ResearchPostDialog {...props} {...next} />),
  };
}

describe("adding research to a post", () => {
  it("previews the available material and adds it to the selected existing draft", async () => {
    const { onSubmit, onOpenChange } = showDialog();

    expect(screen.getByRole("radio", { name: "Existing draft" })).toBeChecked();
    for (const name of ["Quote", "Source link", "Comment"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
    const preview = screen.getByRole("region", { name: "Post preview" });
    expect(preview).toHaveTextContent(material.quote);
    expect(preview).toHaveTextContent(material.comment);
    expect(preview).toHaveTextContent(material.title);

    fireEvent.change(screen.getByLabelText("Draft", { exact: true }), { target: { value: otherDraft.id } });
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: material.title,
      destination: { type: "existing", draftID: otherDraft.id },
      markdown: expect.stringContaining(material.quote),
    }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining(material.sourceURL) }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.stringContaining(material.comment) }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("lets the writer include just a comment", async () => {
    const { onSubmit } = showDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: "Quote" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Source link" }));

    const preview = screen.getByRole("region", { name: "Post preview" });
    expect(preview).toHaveTextContent(material.comment);
    expect(preview).not.toHaveTextContent(material.quote);
    expect(preview).not.toHaveTextContent(material.sourceURL);
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ markdown: material.comment })));
  });

  it("disables submission when no material is selected", () => {
    const { onSubmit } = showDialog();
    for (const name of ["Quote", "Source link", "Comment"]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }

    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Quote" }));
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeEnabled();
  });

  it("creates a new draft with the chosen publication and source title", async () => {
    const { onSubmit } = showDialog();
    fireEvent.click(screen.getByRole("radio", { name: "New draft" }));
    fireEvent.change(screen.getByLabelText("Publication", { exact: true }), { target: { value: otherPublication.uri } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: material.title,
      destination: { type: "new", publicationURI: otherPublication.uri },
      markdown: expect.stringContaining(material.comment),
    })));
  });

  it("starts with a new draft when no existing drafts are available", () => {
    showDialog({ drafts: [] });

    expect(screen.getByRole("radio", { name: "New draft" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: "Existing draft" }));
    expect(screen.getByText(/no .*drafts/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();
  });

  it("explains unavailable publications and prevents creating a draft without one", () => {
    const { onSubmit } = showDialog({ drafts: [], publications: [] });

    expect(screen.getByText(/no publications/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses a publication that loads after the dialog opens", async () => {
    const { onSubmit, updateProps } = showDialog({ drafts: [], publications: [] });
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();

    updateProps({ publications: [publication] });

    expect(screen.getByLabelText("Publication", { exact: true })).toHaveValue(publication.uri);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      destination: { type: "new", publicationURI: publication.uri },
    })));
  });

  it("submits the visible publication when discovery replaces the previous selection", async () => {
    const { onSubmit, updateProps } = showDialog({ drafts: [], publications: [publication] });
    expect(screen.getByLabelText("Publication", { exact: true })).toHaveValue(publication.uri);

    updateProps({ publications: [otherPublication] });

    expect(screen.getByLabelText("Publication", { exact: true })).toHaveValue(otherPublication.uri);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      destination: { type: "new", publicationURI: otherPublication.uri },
    })));
  });

  it("uses an existing draft that loads while the dialog is open", async () => {
    const { onSubmit, updateProps } = showDialog({ drafts: [] });
    fireEvent.click(screen.getByRole("radio", { name: "Existing draft" }));
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();

    updateProps({ drafts: [draft] });

    expect(screen.getByLabelText("Draft", { exact: true })).toHaveValue(draft.id);
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      destination: { type: "existing", draftID: draft.id },
    })));
  });

  it("submits the visible draft when the previous destination becomes unavailable", async () => {
    const { onSubmit, updateProps } = showDialog({ drafts: [draft] });
    expect(screen.getByLabelText("Draft", { exact: true })).toHaveValue(draft.id);

    updateProps({ drafts: [otherDraft] });

    expect(screen.getByLabelText("Draft", { exact: true })).toHaveValue(otherDraft.id);
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      destination: { type: "existing", draftID: otherDraft.id },
    })));
  });

  it("allows a source link without a quote or comment", async () => {
    const { onSubmit } = showDialog({ material: { title: material.title, sourceURL: material.sourceURL } });
    expect(screen.getByRole("checkbox", { name: "Source link" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      markdown: expect.stringContaining(material.sourceURL),
    })));
  });

  it.each(["rejected", "thrown"])("keeps the selection open after a %s save and allows retry", async (failure) => {
    const onSubmit = vi.fn<ComponentProps<typeof ResearchPostDialog>["onSubmit"]>();
    if (failure === "thrown") onSubmit.mockRejectedValueOnce(new Error("The draft service is unavailable."));
    else onSubmit.mockResolvedValueOnce(false);
    onSubmit.mockResolvedValueOnce(true);
    const { onOpenChange } = showDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Draft", { exact: true }), { target: { value: otherDraft.id } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Quote" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Draft", { exact: true })).toHaveValue(otherDraft.id);
    expect(screen.getByRole("checkbox", { name: "Quote" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]).toEqual(onSubmit.mock.calls[0]);
  });

  it("prevents duplicate writes, changed selections, and dismissal while saving", async () => {
    let finish!: (success: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { finish = resolve; });
    const onSubmit = vi.fn<ComponentProps<typeof ResearchPostDialog>["onSubmit"]>().mockReturnValue(pending);
    const { onOpenChange } = showDialog({ onSubmit });
    const submit = screen.getByRole("button", { name: "Add to draft" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Draft", { exact: true })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "New draft" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Quote" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const close = screen.queryByRole("button", { name: "Close" });
    if (close) fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => finish(true));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
