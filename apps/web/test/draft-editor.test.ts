import { describe, expect, it } from "vitest";
import { slugPathFromTitle, titleManagedPath } from "@/lib/draft-editor";

describe("draft editor helpers", () => {
  it("generates a normalized path from a title", () => {
    expect(slugPathFromTitle("  Here's Café News!  ", "1rvx8wv")).toBe("/heres-cafe-news-1rvx8wv");
    expect(slugPathFromTitle("🔥", "abcdef0")).toBe("/untitled-article-abcdef0");
  });

  it("keeps generating paths only while the current draft path is title-managed", () => {
    expect(titleManagedPath({ status: "draft", title: "Old title", path: "/old-title-1rvx8wv" })).toBe(true);
    expect(titleManagedPath({ status: "draft", title: "Old title", path: "/old-title" })).toBe(true);
    expect(titleManagedPath({ status: "draft", title: "Old title", path: "/custom-path" })).toBe(false);
    expect(titleManagedPath({ status: "published", title: "Old title", path: "/old-title" })).toBe(false);
  });
});
