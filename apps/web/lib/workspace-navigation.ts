export type WorkspaceView = "posts" | "publications" | "feedback";
export type MobileWorkspacePane = "list" | "write" | "details" | "schedule";

export type WorkspaceNavigationState = {
  view: WorkspaceView;
  draftID: string;
  pane: MobileWorkspacePane;
};

const workspaceViews = new Set<WorkspaceView>(["posts", "publications", "feedback"]);
const editorPanes = new Set<MobileWorkspacePane>(["write", "details", "schedule"]);

export const defaultWorkspaceNavigation: WorkspaceNavigationState = {
  view: "posts",
  draftID: "",
  pane: "list",
};

export function parseWorkspaceNavigation(search: string): WorkspaceNavigationState {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view") as WorkspaceView | null;
  const view = requestedView && workspaceViews.has(requestedView) ? requestedView : "posts";
  const draftID = view === "posts" ? params.get("draft")?.trim() ?? "" : "";
  const requestedPane = params.get("pane") as MobileWorkspacePane | null;
  const pane = draftID && requestedPane && editorPanes.has(requestedPane) ? requestedPane : draftID ? "write" : "list";

  return { view, draftID, pane };
}

export function workspaceNavigationURL(state: WorkspaceNavigationState) {
  const params = new URLSearchParams();
  if (state.view !== "posts") params.set("view", state.view);
  if (state.view === "posts" && state.draftID) {
    params.set("draft", state.draftID);
    params.set("pane", state.pane === "list" ? "write" : state.pane);
  }
  const search = params.toString();
  return search ? `/editor?${search}` : "/editor";
}
