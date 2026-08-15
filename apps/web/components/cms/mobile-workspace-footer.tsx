"use client";

import { BookOpenIcon, LibraryIcon, MessageSquareTextIcon, RocketIcon, SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DraftSaveState } from "@/lib/draft-editor";
import type { WorkspaceView } from "@/lib/workspace-navigation";

export function MobileWorkspaceFooter({
  activeView,
  editing,
  saveState,
  canPublish,
  isPublishing,
  isUpdating,
  onViewChange,
  onSave,
  onPublish,
}: {
  activeView: WorkspaceView;
  editing: boolean;
  saveState: DraftSaveState;
  canPublish: boolean;
  isPublishing: boolean;
  isUpdating: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onSave: () => void;
  onPublish: () => void;
}) {
  if (editing) {
    return (
      <footer className="z-20 flex shrink-0 items-center gap-2 border-t bg-background/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur xl:hidden">
        <span
          className={cn("min-w-0 flex-1 truncate text-xs", saveState === "error" ? "text-destructive" : "text-muted-foreground")}
          aria-live="polite"
        >
          {saveStateLabel(saveState)}
        </span>
        <Button variant="outline" onClick={onSave} disabled={saveState === "saving"}>
          <SaveIcon data-icon="inline-start" />
          Save
        </Button>
        <Button onClick={onPublish} disabled={!canPublish || isPublishing}>
          <RocketIcon data-icon="inline-start" className={cn(isPublishing && "animate-pulse")} />
          {isPublishing ? (isUpdating ? "Updating…" : "Publishing…") : isUpdating ? "Update" : "Publish"}
        </Button>
      </footer>
    );
  }

  const views = [
    { value: "posts", label: "Posts", icon: BookOpenIcon },
    { value: "publications", label: "Publications", icon: LibraryIcon },
    { value: "feedback", label: "Feedback", icon: MessageSquareTextIcon },
  ] as const;

  return (
    <nav
      aria-label="Mobile workspace"
      className="z-20 grid shrink-0 grid-cols-3 border-t bg-background/95 px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] backdrop-blur xl:hidden"
    >
      {views.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`Open ${label}`}
          aria-current={activeView === value ? "page" : undefined}
          onClick={() => onViewChange(value)}
          className={cn(
            "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md px-2 text-[11px] font-medium transition-colors",
            activeView === value ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <Icon className={cn("size-5", activeView === value && "text-primary")} aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  );
}

export function saveStateLabel(saveState: DraftSaveState) {
  return {
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    error: "Autosave failed",
  }[saveState];
}
