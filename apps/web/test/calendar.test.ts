import { describe, expect, it } from "vitest";
import { calendarItemsFromDrafts, seedDrafts } from "@/lib/cms-data";

describe("calendarItemsFromDrafts", () => {
  it("includes scheduled and published drafts only", () => {
    const items = calendarItemsFromDrafts(seedDrafts);

    expect(items.map((item) => item.status)).toEqual(["published", "scheduled"]);
    expect(items.some((item) => item.status === "draft")).toBe(false);
  });
});
