import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchSection } from "@/components/cms/research-section";

const mocks = vi.hoisted(() => ({ loadResearch: vi.fn() }));

vi.mock("@/lib/research-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/research-api")>();
  return { ...original, loadResearch: mocks.loadResearch };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadResearch.mockResolvedValue({
    semble: {
      collections: [{
        uri: "at://did:plc:writer/network.cosmik.collection/research",
        name: "Things to write about",
        description: "Saved prompts and source material.",
        accessType: "CLOSED",
        cards: [{
          uri: "at://did:plc:writer/network.cosmik.card/source",
          url: "https://example.com/source",
          title: "A promising source",
          description: "A useful description.",
          siteName: "Example",
          author: "A. Writer",
          note: "Revisit the central claim.",
          createdAt: "2026-08-29T12:00:00.000Z",
        }],
      }],
    },
    margin: {
      annotations: [{
        uri: "at://did:plc:writer/at.margin.note/note",
        motivation: "highlighting",
        source: "https://example.org/essay",
        title: "An essay worth revisiting",
        body: "Connect this to the publishing workflow.",
        quote: "A highlighted passage",
        tags: ["publishing"],
        createdAt: "2026-08-30T12:00:00.000Z",
      }],
    },
  });
});

describe("research workspace", () => {
  it("browses the linked user's Semble collections and Margin annotations", async () => {
    render(<ResearchSection onUseInPost={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Things to write about" })).toBeInTheDocument();
    expect(screen.getByText("A promising source")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open source/ })).toHaveAttribute("href", "https://example.com/source");

    const marginTab = screen.getByRole("tab", { name: /Margin 1/ });
    fireEvent.mouseDown(marginTab, { button: 0, ctrlKey: false });
    fireEvent.click(marginTab);
    expect(screen.getByRole("heading", { name: "An essay worth revisiting" })).toBeInTheDocument();
    expect(screen.getByText("“A highlighted passage”")).toBeInTheDocument();
    expect(screen.getByText("Connect this to the publishing workflow.")).toBeInTheDocument();
  });

  it("keeps one source usable when the other reports a partial failure", async () => {
    mocks.loadResearch.mockResolvedValue({
      semble: { collections: [], error: "Semble records could not be loaded." },
      margin: { annotations: [] },
    });

    render(<ResearchSection onUseInPost={vi.fn()} />);

    expect(await screen.findByText("Semble records could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("No Semble collections found")).toBeInTheDocument();
    const marginTab = screen.getByRole("tab", { name: /Margin 0/ });
    fireEvent.mouseDown(marginTab, { button: 0, ctrlKey: false });
    fireEvent.click(marginTab);
    expect(screen.getByText("No Margin annotations found")).toBeInTheDocument();
  });

  it("offers retry after the inventory request fails", async () => {
    mocks.loadResearch
      .mockRejectedValueOnce(new Error("Research service unavailable"))
      .mockResolvedValueOnce({ semble: { collections: [] }, margin: { annotations: [] } });

    render(<ResearchSection onUseInPost={vi.fn()} />);

    expect(await screen.findByText("Research service unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.loadResearch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No Semble collections found")).toBeInTheDocument();
  });

  it("does not expose unsafe source schemes as links", async () => {
    mocks.loadResearch.mockResolvedValue({
      semble: {
        collections: [{
          uri: "at://did:plc:writer/network.cosmik.collection/unsafe",
          name: "Unsafe links",
          accessType: "OPEN",
          cards: [{
            uri: "at://did:plc:writer/network.cosmik.card/unsafe",
            url: "javascript:alert(1)",
            title: "Untrusted item",
          }],
        }],
      },
      margin: { annotations: [] },
    });

    render(<ResearchSection onUseInPost={vi.fn()} />);

    expect(await screen.findByText("Untrusted item")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open source/ })).not.toBeInTheDocument();
  });
});
