import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackSection } from "@/components/cms/feedback-section";
import { hasFeedbackPermission } from "@/lib/feedback-api";
import type { LinkedAccount } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  loadFeedbackBoard: vi.fn(),
  submitFeedback: vi.fn(),
  uploadImage: vi.fn(),
}));

vi.mock("@/lib/feedback-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/feedback-api")>();
  return {
    ...original,
    loadFeedbackBoard: mocks.loadFeedbackBoard,
    submitFeedback: mocks.submitFeedback,
  };
});

vi.mock("@/lib/asset-api", () => ({ uploadImage: mocks.uploadImage }));

const account: LinkedAccount = {
  did: "did:plc:writer",
  handle: "writer.example",
  pdsURL: "https://pds.example",
  scope: "atproto include:app.userinput.authFull blob:*/*",
  linkedAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadFeedbackBoard.mockResolvedValue({
    name: "AnyPub",
    uri: "at://did:plc:owner/app.userinput.space/board",
    publicURL: "https://userinput.app/s/owner/board",
    tags: [
      { label: "Bug", value: "bug" },
      { label: "Feature", value: "feature" },
    ],
  });
  mocks.uploadImage.mockResolvedValue({ id: "asset-one" });
  mocks.submitFeedback.mockResolvedValue({
    uri: "at://did:plc:writer/app.userinput.discussion/post",
    cid: "post-cid",
    url: "https://userinput.app/d/did:plc:writer/post?lang=en",
  });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "image-one") });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
});

describe("feedback workspace", () => {
  it("recognizes full, qualified, and granular discussion grants", () => {
    expect(hasFeedbackPermission("atproto include:app.userinput.authFull")).toBe(true);
    expect(hasFeedbackPermission("include:app.userinput.authFull?aud=did:web:userinput.app")).toBe(true);
    expect(hasFeedbackPermission("repo:app.userinput.discussion?action=create")).toBe(true);
    expect(hasFeedbackPermission("repo?collection=app.userinput.discussion&action=create")).toBe(true);
    expect(hasFeedbackPermission("repo:*")).toBe(true);
    expect(hasFeedbackPermission("atproto include:site.standard.authFull")).toBe(false);
  });

  it("loads board tags, previews an image, and submits its asset ID", async () => {
    render(<FeedbackSection account={account} onReconnect={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Bug" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bug" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A feedback title" } });
    fireEvent.change(screen.getByLabelText("Details"), { target: { value: "More detail" } });

    const file = new File(["image"], "screen.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Attach feedback images"), { target: { files: [file] } });
    expect(await screen.findByAltText("screen.png")).toHaveAttribute("src", "blob:preview");

    fireEvent.click(screen.getByRole("button", { name: "Publish feedback" }));
    await waitFor(() => expect(mocks.submitFeedback).toHaveBeenCalledWith({
      title: "A feedback title",
      body: "More detail",
      tags: ["bug"],
      assetIDs: ["asset-one"],
    }));
    expect(await screen.findByText("Thanks for helping shape AnyPub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View feedback/ })).toHaveAttribute(
      "href",
      "https://userinput.app/d/did:plc:writer/post?lang=en",
    );
  });

  it("requires an OAuth reconnect for older sessions", async () => {
    const onReconnect = vi.fn();
    render(<FeedbackSection account={{ ...account, scope: "atproto" }} onReconnect={onReconnect} />);

    expect(await screen.findByText("Reconnect to send feedback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish feedback" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Log out to reconnect" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});
