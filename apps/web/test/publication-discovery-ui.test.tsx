import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CmsWorkspace } from "@/components/cms/cms-workspace";
import { RightPanel } from "@/components/cms/right-panel";
import type { Draft } from "@/lib/types";

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publication discovery UI", () => {
  it("shows a discoverable empty state and disables draft creation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/accounts")
        ? [{
            id: "account-id",
            did: "did:plc:writer",
            handle: "writer.example",
            pdsURL: "https://pds.example",
            scope: "atproto",
            linkedAt: "2026-08-11T00:00:00.000Z",
            updatedAt: "2026-08-11T00:00:00.000Z",
          }]
        : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CmsWorkspace />);

    expect(await screen.findByText("No publications found")).toBeInTheDocument();
    expect(screen.getByText(/Refresh publication discovery/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/publications/sync",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("renders an unavailable publication without substituting another one", () => {
    const draft: Draft = {
      id: "draft-id",
      accountDID: "did:plc:writer",
      publicationURI: "at://did:plc:writer/site.standard.publication/removed",
      publicationURL: "https://removed.example",
      title: "Orphaned draft",
      tags: [],
      markdown: "Body",
      plaintext: "Body",
      status: "draft",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    };

    render(
      <RightPanel
        draft={draft}
        selectedPublication={undefined}
        calendarItems={[]}
        onScheduledDate={() => {}}
        onSchedule={() => {}}
        onDraftChange={() => {}}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Publication unavailable")).toBeInTheDocument();
    expect(screen.getByText(draft.publicationURI)).toBeInTheDocument();
  });
});
