import { describe, expect, it } from "vitest";
import {
  anyPubAssetIDFromImageURL,
  markdownForAnyPubImage,
  resolveAnyPubImageURL,
} from "@/lib/editor-images";

const assetID = "d9428888-122b-11e1-b85c-61cd3cbb3210";

describe("AnyPub editor image adapter", () => {
  it("keeps AnyPub asset storage syntax outside the editor package", () => {
    expect(markdownForAnyPubImage(assetID, "System ] diagram")).toBe(
      `![System  diagram](anypub-asset://${assetID})`,
    );
    expect(anyPubAssetIDFromImageURL(`anypub-asset://${assetID}`)).toBe(assetID);
  });

  it("resolves only valid AnyPub image references through the asset API", () => {
    expect(resolveAnyPubImageURL(`anypub-asset://${assetID}`)).toBe(
      `http://localhost:8080/api/assets/${assetID}/content`,
    );
    expect(resolveAnyPubImageURL("https://example.com/image.png")).toBeUndefined();
    expect(anyPubAssetIDFromImageURL("anypub-asset://not/an/id")).toBeUndefined();
  });

  it("rejects invalid IDs before writing Markdown", () => {
    expect(() => markdownForAnyPubImage("not/an/id", "Diagram")).toThrow(/Invalid AnyPub asset ID/);
  });
});
