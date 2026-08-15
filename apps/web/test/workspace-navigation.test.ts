import { describe, expect, it } from "vitest";
import {
  defaultWorkspaceNavigation,
  parseWorkspaceNavigation,
  workspaceNavigationURL,
} from "@/lib/workspace-navigation";

describe("workspace navigation", () => {
  it("defaults invalid and incomplete query state to the posts library", () => {
    expect(parseWorkspaceNavigation("?view=unknown&pane=schedule")).toEqual(defaultWorkspaceNavigation);
    expect(parseWorkspaceNavigation("?pane=details")).toEqual(defaultWorkspaceNavigation);
  });

  it("opens a requested draft in Write unless a valid pane is supplied", () => {
    expect(parseWorkspaceNavigation("?draft=draft-1")).toEqual({
      view: "posts",
      draftID: "draft-1",
      pane: "write",
    });
    expect(parseWorkspaceNavigation("?draft=draft-1&pane=schedule")).toEqual({
      view: "posts",
      draftID: "draft-1",
      pane: "schedule",
    });
  });

  it("keeps global destinations independent from draft state", () => {
    expect(parseWorkspaceNavigation("?view=feedback&draft=draft-1&pane=details")).toEqual({
      view: "feedback",
      draftID: "",
      pane: "list",
    });
  });

  it("serializes stable, minimal editor URLs", () => {
    expect(workspaceNavigationURL(defaultWorkspaceNavigation)).toBe("/editor");
    expect(workspaceNavigationURL({ view: "publications", draftID: "ignored", pane: "details" }))
      .toBe("/editor?view=publications");
    expect(workspaceNavigationURL({ view: "posts", draftID: "draft 1", pane: "details" }))
      .toBe("/editor?draft=draft+1&pane=details");
  });
});
