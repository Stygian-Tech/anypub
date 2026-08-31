import { afterEach, describe, expect, it, vi } from "vitest";
import { loadResearch } from "@/lib/research-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research API", () => {
  it("loads the authenticated account research inventory", async () => {
    const payload = {
      semble: { collections: [] },
      margin: { annotations: [] },
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadResearch()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/research",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
