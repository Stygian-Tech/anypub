import { afterEach, describe, expect, it, vi } from "vitest";
import { assetContentURL, uploadImage } from "@/lib/asset-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("image asset API", () => {
  it("uploads image dimensions and returns a preview URL", async () => {
    class TestImage {
      naturalWidth = 1200;
      naturalHeight = 630;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", TestImage);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("accountDID")).toBe("did:plc:writer");
      expect(form.get("altText")).toBe("Diagram");
      expect(form.get("width")).toBe("1200");
      expect(form.get("height")).toBe("630");
      return Response.json({
        id: "d9428888-122b-11e1-b85c-61cd3cbb3210",
        accountDID: "did:plc:writer",
        source: "device",
        mimeType: "image/png",
        byteSize: 4,
        width: 1200,
        height: 630,
        createdAt: "2026-08-12T00:00:00.000Z",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([137, 80, 78, 71])], "diagram.png", { type: "image/png" });
    const asset = await uploadImage("did:plc:writer", file, "Diagram");

    expect(asset.width).toBe(1200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/assets/upload",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(assetContentURL(asset.id)).toBe(
      "http://localhost:8080/api/assets/d9428888-122b-11e1-b85c-61cd3cbb3210/content",
    );
  });
});
