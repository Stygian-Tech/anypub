import { describe, expect, it } from "vitest";
import { calendarItemsFromDrafts, seedDrafts, sortDraftsReverseChronological } from "@/lib/cms-data";

describe("calendarItemsFromDrafts", () => {
  it("includes scheduled and published drafts only", () => {
    const items = calendarItemsFromDrafts(seedDrafts);

    expect(items.map((item) => item.status)).toEqual(["published", "scheduled"]);
    expect(items.some((item) => item.status === "draft")).toBe(false);
  });
});

describe("sortDraftsReverseChronological", () => {
  it("sorts scheduled, published, and local drafts by their relevant activity date", () => {
    expect(sortDraftsReverseChronological(seedDrafts).map((draft) => draft.id)).toEqual([
      "draft-1",
      "draft-2",
      "draft-3",
    ]);
  });
});
