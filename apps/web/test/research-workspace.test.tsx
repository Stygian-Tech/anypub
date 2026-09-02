import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CmsWorkspace } from "@/components/cms/cms-workspace";
import type { Draft, Publication } from "@/lib/types";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigation.replace }) }));

// Keep the workspace's real state, persistence, navigation, and research UI while
// exposing a simple body input for testing edits racing with asynchronous saves.
vi.mock("@/components/cms/editor-panel", () => ({
  EditorPanel: ({ draft, onChange, saveState }: {
    draft: Draft;
    onChange: (patch: Partial<Draft>) => void;
    saveState: string;
  }) => (
    <section aria-label="Post editor content">
      <h2>{draft.title}</h2>
      <label>Draft body<textarea value={draft.markdown} onChange={(event) => onChange({ markdown: event.target.value })} /></label>
      <output aria-label="Draft revision">{draft.blockRevision}</output>
      <output aria-label="Draft save state">{saveState}</output>
    </section>
  ),
}));

const account = {
  did: "did:plc:writer",
  handle: "writer.example",
  pdsURL: "https://pds.example",
  scope: "atproto",
  linkedAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const publication: Publication = {
  id: "publication-one",
  accountDID: account.did,
  uri: `at://${account.did}/site.standard.publication/field-notes`,
  name: "Field Notes",
  url: "https://field-notes.example",
  syncedAt: "2026-09-01T12:00:00.000Z",
};

const otherPublication: Publication = {
  ...publication,
  id: "publication-two",
  uri: `at://${account.did}/site.standard.publication/workbench`,
  name: "Workbench",
  url: "https://workbench.example",
};

const draft: Draft = {
  id: "draft-one",
  accountDID: account.did,
  publicationURI: publication.uri,
  publicationURL: publication.url,
  title: "My existing essay",
  path: "/my-existing-essay",
  excerpt: "A carefully chosen excerpt",
  tags: ["essay", "research"],
  coverAssetID: "cover-one",
  markdown: "# Existing heading\n\nAn existing paragraph.",
  plaintext: "Existing heading\n\nAn existing paragraph.",
  blockRevision: 8,
  blockSchemaVersion: 1,
  status: "draft",
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const research = {
  semble: {
    collections: [{
      uri: `at://${account.did}/network.cosmik.collection/research`,
      name: "Research sources",
      accessType: "CLOSED",
      cards: [{
        uri: `at://${account.did}/network.cosmik.card/source`,
        title: "An intriguing source",
        url: "https://example.org/source",
        note: "A connection to develop",
      }],
    }],
  },
  margin: { annotations: [] },
};

type Write = { url: string; method: string; body: Partial<Draft> };

function installAPI(options: {
  drafts?: Draft[];
  publications?: Publication[];
  onWrite?: (write: Write, count: number) => Promise<Response | undefined> | Response | undefined;
} = {}) {
  const drafts = options.drafts ?? [draft];
  const publications = options.publications ?? [publication, otherPublication];
  const writes: Write[] = [];
  const persistedResponse = (write: Write) => Response.json({
    ...(drafts.find((candidate) => write.url.endsWith(`/${candidate.id}`)) ?? draft),
    ...write.body,
    id: write.method === "POST" ? "created-draft" : write.url.split("/").at(-1),
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/accounts")) return Response.json([account]);
    if (url.endsWith("/api/research")) return Response.json(research);
    if (url.includes("/api/publications")) return Response.json(publications);
    if (url.endsWith("/api/drafts/backfill")) return Response.json([]);
    if (url.includes("/api/drafts") && (init?.method === "POST" || init?.method === "PUT")) {
      const write = { url, method: init.method, body: JSON.parse(String(init.body)) as Partial<Draft> };
      writes.push(write);
      return (await options.onWrite?.(write, writes.length)) ?? persistedResponse(write);
    }
    if (url.includes("/api/drafts?")) return Response.json(drafts);
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { writes, fetchMock, persistedResponse };
}

async function openResearchComposer() {
  fireEvent.click(await screen.findByRole("button", { name: "Research" }));
  const useInPost = await screen.findByRole("button", { name: "Use in post" });
  await waitFor(() => expect(useInPost).toBeEnabled());
  fireEvent.click(useInPost);
  return screen.getByRole("dialog", { name: "Use in post" });
}

async function expectEditorBody(markdown: string) {
  await waitFor(() => expect(screen.getByLabelText("Draft body")).toHaveValue(markdown));
  expect(screen.queryByRole("dialog", { name: "Use in post" })).not.toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("draft")).toBeTruthy();
}

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
    value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research in the publishing workspace", () => {
  it("appends a source to an existing draft, preserving metadata and opening the saved snapshot", async () => {
    const { writes } = installAPI();
    render(<CmsWorkspace />);
    await openResearchComposer();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    const { body } = writes[0];
    expect(writes[0]).toMatchObject({ method: "PUT", url: `http://localhost:8080/api/drafts/${draft.id}` });
    expect(body).toMatchObject({
      accountDID: draft.accountDID,
      publicationURI: draft.publicationURI,
      publicationURL: draft.publicationURL,
      title: draft.title,
      path: draft.path,
      excerpt: draft.excerpt,
      tags: draft.tags,
      coverAssetID: draft.coverAssetID,
      blockRevision: 9,
      blockSchemaVersion: 1,
    });
    expect(body.markdown).toBe(`${draft.markdown}\n\n[An intriguing source](https://example.org/source)\n\nA connection to develop`);
    expect(JSON.parse(body.blockDocumentJSON!)).toMatchObject({ markdown: body.markdown, revision: body.blockRevision, schemaVersion: 1 });
    await expectEditorBody(body.markdown!);
    expect(screen.getByLabelText("Draft revision")).toHaveTextContent("9");
    expect(new URLSearchParams(window.location.search).get("draft")).toBe(draft.id);
  });

  it("creates one new draft for the chosen publication, then opens it", async () => {
    const { writes } = installAPI();
    render(<CmsWorkspace />);
    await openResearchComposer();
    fireEvent.click(screen.getByRole("radio", { name: "New draft" }));
    fireEvent.change(screen.getByLabelText("Publication", { exact: true }), { target: { value: otherPublication.uri } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      method: "POST",
      url: "http://localhost:8080/api/drafts",
      body: {
        accountDID: account.did,
        publicationURI: otherPublication.uri,
        publicationURL: otherPublication.url,
        title: "An intriguing source",
        tags: [],
        blockRevision: 1,
      },
    });
    expect(writes[0].body.path).toMatch(/^\/an-intriguing-source-[a-z0-9]{7}$/);
    expect(writes[0].body.markdown).not.toContain(draft.markdown);
    await expectEditorBody(writes[0].body.markdown!);
    expect(new URLSearchParams(window.location.search).get("draft")).toBe("created-draft");
  });

  it("offers only editable drafts and publications owned by the active account", async () => {
    const excluded = ["scheduled", "publishing", "published"].map((status) => ({
      ...draft, id: status, title: `${status} essay`, status: status as Draft["status"],
    }));
    installAPI({
      drafts: [draft, { ...draft, id: "failed", title: "Failed essay", status: "failed" }, ...excluded,
        { ...draft, id: "foreign", title: "Another account's essay", accountDID: "did:plc:other" }],
      publications: [publication, { ...otherPublication, accountDID: "did:plc:other" }],
    });
    render(<CmsWorkspace />);
    await openResearchComposer();

    const drafts = within(screen.getByLabelText("Draft", { exact: true })).getAllByRole("option");
    expect(drafts.map((option) => (option as HTMLOptionElement).value).sort()).toEqual(["draft-one", "failed"]);
    fireEvent.click(screen.getByRole("radio", { name: "New draft" }));
    const publications = within(screen.getByLabelText("Publication", { exact: true })).getAllByRole("option");
    expect(publications).toHaveLength(1);
    expect(publications[0]).toHaveValue(publication.uri);
  });

  it("retries a failed save without appending the source twice", async () => {
    const { writes } = installAPI({ onWrite: (_write, count) => count === 1 ? Response.json({ reason: "Unavailable" }, { status: 503 }) : undefined });
    render(<CmsWorkspace />);
    await openResearchComposer();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(new URLSearchParams(window.location.search).get("view")).toBe("research");
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    await waitFor(() => expect(writes).toHaveLength(2));
    const { blockDocumentJSON: firstJSON, ...firstBody } = writes[0].body;
    const { blockDocumentJSON: secondJSON, ...secondBody } = writes[1].body;
    expect(secondBody).toEqual(firstBody);
    const comparableSnapshot = (json: string) => {
      const snapshot = JSON.parse(json) as { blocks: Array<{ id: string; source: string }> };
      return { ...snapshot, blocks: snapshot.blocks.map(({ source }) => source) };
    };
    expect(comparableSnapshot(secondJSON!)).toEqual(comparableSnapshot(firstJSON!));
    expect(writes[1].body.markdown!.split("https://example.org/source")).toHaveLength(2);
    await expectEditorBody(writes[1].body.markdown!);
  });

  it("includes unsaved local writing and cancels its older pending autosave", async () => {
    const { writes } = installAPI();
    render(<CmsWorkspace />);
    const body = await screen.findByLabelText("Draft body");
    const unsaved = `${draft.markdown}\n\nA local paragraph that has not been saved`;
    fireEvent.change(body, { target: { value: unsaved } });
    expect(writes).toHaveLength(0);
    await openResearchComposer();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body.markdown).toContain(`${unsaved}\n\n[An intriguing source]`);
    await expectEditorBody(writes[0].body.markdown!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(writes).toHaveLength(1);
  });

  it("waits for an in-flight autosave before saving research with newer local writing", async () => {
    let finishAutosave!: (response: Response) => void;
    const firstSave = new Promise<Response>((resolve) => { finishAutosave = resolve; });
    const { writes, persistedResponse } = installAPI({ onWrite: (_write, count) => count === 1 ? firstSave : undefined });
    render(<CmsWorkspace />);
    const body = await screen.findByLabelText("Draft body");
    const autosaving = `${draft.markdown}\n\nFirst local paragraph`;
    fireEvent.change(body, { target: { value: autosaving } });
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 1500 });
    const newest = `${autosaving}\n\nNewer local paragraph`;
    fireEvent.change(body, { target: { value: newest } });
    await openResearchComposer();
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(writes).toHaveLength(1);
    await act(async () => finishAutosave(persistedResponse(writes[0])));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0].body.markdown).toBe(autosaving);
    expect(writes[1].body.markdown).toContain(`${newest}\n\n[An intriguing source]`);
    await expectEditorBody(writes[1].body.markdown!);
    expect(screen.getByLabelText("Draft save state")).toHaveTextContent("saved");
  });
});
