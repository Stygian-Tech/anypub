import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CmsWorkspace } from "@/components/cms/cms-workspace";
import { backfillPublishedPosts } from "@/lib/draft-api";
import type { Draft } from "@/lib/types";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

const account = {
  id: "account-id",
  did: "did:plc:writer",
  handle: "writer.example",
  pdsURL: "https://pds.example",
  scope: "atproto",
  linkedAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const publication = {
  id: "publication-id",
  accountDID: account.did,
  uri: `at://${account.did}/site.standard.publication/blog`,
  name: "Writer Blog",
  url: "https://writer.example",
  syncedAt: "2026-08-11T00:00:00.000Z",
};

const backfilled: Draft = {
  id: "backfilled-draft",
  accountDID: account.did,
  publicationURI: publication.uri,
  publicationURL: publication.url,
  title: "Written before AnyPub",
  path: "/written-before-anypub",
  tags: [],
  markdown: "Published from another client.",
  plaintext: "Published from another client.",
  status: "published",
  publishedAt: "2026-08-01T00:00:00.000Z",
  documentURI: `at://${account.did}/site.standard.document/3lbackfill`,
  documentCID: "record-cid",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
  navigation.replace.mockReset();
  window.history.replaceState({}, "", "/editor");
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

describe("published post backfill", () => {
  it("requests the backfill for the signed-in account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await backfillPublishedPosts(account.did);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/drafts/backfill",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ accountDID: account.did }),
      }),
    );
  });

  it("lists posts imported from the PDS alongside local drafts", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/accounts")) return Response.json([account]);
      if (url.endsWith("/api/drafts/backfill")) return Response.json([backfilled]);
      if (url.includes("/api/drafts")) return Response.json([]);
      return Response.json([publication]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CmsWorkspace />);

    await waitFor(() => expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/drafts/backfill")),
    ).toBe(true));

    const publishedTab = await screen.findByRole("tab", { name: "Published" });
    fireEvent.mouseDown(publishedTab, { button: 0, ctrlKey: false });
    fireEvent.click(publishedTab);
    expect(await screen.findByText("Written before AnyPub")).toBeInTheDocument();
  });

  it("imports each account's published posts only once per session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/accounts")) return Response.json([account]);
      if (url.endsWith("/api/drafts/backfill")) return Response.json([backfilled]);
      if (url.includes("/api/drafts")) return Response.json([]);
      return Response.json([publication]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CmsWorkspace />);

    await waitFor(() => expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/drafts/backfill")),
    ).toHaveLength(1));
  });
});
