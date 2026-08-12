import { afterEach, describe, expect, it, vi } from "vitest";
import { publishDraft, syncPublications, unpublishDraft } from "@/lib/draft-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishing API", () => {
  it("publishes a persisted draft through the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      documentURI: "at://did:plc:writer/site.standard.document/3mtest",
      documentCID: "bafytest",
      platformDocumentURI: "at://did:plc:writer/blog.pckt.document/3mtest",
      platformDocumentCID: "bafywrapper",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishDraft("draft-id");

    expect(result.platformDocumentURI).toContain("blog.pckt.document");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/drafts/draft-id/publish",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("syncs publications through the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await syncPublications("did:plc:writer");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/publications/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accountDID: "did:plc:writer" }),
      }),
    );
  });

  it("unpublishes a remote article while retaining its local draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "draft-id",
      status: "draft",
      title: "Editable article",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await unpublishDraft("draft-id");

    expect(result.status).toBe("draft");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/drafts/draft-id/unpublish",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
