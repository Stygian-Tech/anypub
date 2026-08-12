import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("shows account identity, publication icons, and a complete publications inventory", async () => {
    const account = {
      id: "account-id",
      did: "did:plc:writer",
      handle: "writer.example",
      displayName: "Sam Writer",
      avatarURL: "https://pds.example/avatar.jpg",
      pdsURL: "https://pds.example",
      scope: "atproto",
      linkedAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    const publications = [
      {
        id: "publication-one",
        accountDID: account.did,
        uri: `at://${account.did}/site.standard.publication/field-notes`,
        cid: "publication-cid",
        name: "Field Notes",
        url: "https://field-notes.example",
        description: "Essays from the field.",
        iconURL: "https://pds.example/field-notes.png",
        host: "leaflet",
        syncedAt: "2026-08-11T20:00:00.000Z",
      },
      {
        id: "publication-two",
        accountDID: account.did,
        uri: `at://${account.did}/site.standard.publication/workbench`,
        cid: "publication-two-cid",
        name: "Workbench",
        url: "https://workbench.example",
        syncedAt: "2026-08-11T20:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/accounts")
        ? [account]
        : url.includes("/api/publications")
          ? publications
          : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CmsWorkspace />);

    expect(await screen.findByText("Sam Writer")).toBeInTheDocument();
    expect(screen.getByText("@writer.example")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sam Writer profile picture" })).toHaveStyle({
      backgroundImage: "url(https://pds.example/avatar.jpg)",
    });

    const newButton = screen.getByRole("button", { name: "New" });
    await waitFor(() => expect(newButton).toBeEnabled());
    fireEvent.click(newButton);
    expect(await screen.findByRole("img", { name: "Field Notes icon" })).toHaveAttribute(
      "src",
      "https://pds.example/field-notes.png",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Publications" }));
    expect(await screen.findByText("2 publications are available to AnyPub.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Notes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workbench" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /View site/ })).toHaveLength(2);
  });

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

  it("logs out the active account and returns to the OAuth connect screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
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
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByText("Connect your publication account")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/accounts/did%3Aplc%3Awriter",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("generates a title path and autosaves the edited draft", async () => {
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
    const draft: Draft = {
      id: "draft-id",
      accountDID: account.did,
      publicationURI: publication.uri,
      publicationURL: publication.url,
      title: "Untitled article",
      path: "/untitled-article",
      excerpt: "",
      tags: [],
      markdown: "Body",
      plaintext: "Body",
      status: "draft",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PUT" && url.endsWith(`/api/drafts/${draft.id}`)) {
        const payload = JSON.parse(String(init.body));
        return Response.json({ ...draft, ...payload, plaintext: draft.plaintext, updatedAt: "2026-08-11T00:00:01.000Z" });
      }
      const body = url.endsWith("/api/accounts")
        ? [account]
        : url.includes("/api/drafts")
          ? [draft]
          : [publication];
      return Response.json(body);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CmsWorkspace />);
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Café News & Notes" } });

    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect((screen.getByLabelText("Path") as HTMLInputElement).value).toMatch(/^\/cafe-news-notes-[a-z0-9]{7}$/);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/drafts/draft-id",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringMatching(/"path":"\/cafe-news-notes-[a-z0-9]{7}"/),
        }),
      );
      expect(screen.getByRole("status")).toHaveTextContent("Saved");
    }, { timeout: 2_000 });
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
