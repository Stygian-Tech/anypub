"use client";

import { BookOpenIcon, LibraryIcon, LogOutIcon, MoonIcon, RefreshCwIcon, RocketIcon, SunIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NewDraftDialog } from "@/components/cms/post-dialogs";
import type { ThemePreference } from "@/lib/preferences";
import type { Publication } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({
  activeView,
  theme,
  publications,
  isSyncing,
  isPublishing,
  isUpdating,
  isLoggingOut,
  canPublish,
  onThemeChange,
  onSync,
  onCreateDraft,
  onPublish,
  onLogOut,
  onViewChange,
}: {
  activeView: "posts" | "publications";
  theme: ThemePreference;
  publications: Publication[];
  isSyncing: boolean;
  isPublishing: boolean;
  isUpdating: boolean;
  isLoggingOut: boolean;
  canPublish: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onSync: () => void;
  onCreateDraft: (publicationURI: string) => Promise<boolean>;
  onPublish: () => void;
  onLogOut: () => void;
  onViewChange: (view: "posts" | "publications") => void;
}) {
  return (
    <header className="grid min-h-16 shrink-0 grid-cols-1 items-center gap-3 border-b px-4 py-2 lg:grid-cols-[minmax(180px,1fr)_auto_minmax(320px,1fr)] lg:py-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-semibold">AnyPub</div>
          <Badge variant="accent" className="uppercase tracking-wide">Alpha</Badge>
        </div>
        <div className="text-muted-foreground truncate text-xs">standard.site CMS</div>
      </div>
      <nav aria-label="Workspace" className="bg-muted flex w-fit rounded-md p-1">
        <button
          type="button"
          aria-current={activeView === "posts" ? "page" : undefined}
          onClick={() => onViewChange("posts")}
          className={cn(
            "flex h-8 items-center gap-2 rounded px-3 text-sm transition-colors",
            activeView === "posts" ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <BookOpenIcon className="size-3.5" aria-hidden />
          Posts
        </button>
        <button
          type="button"
          aria-current={activeView === "publications" ? "page" : undefined}
          onClick={() => onViewChange("publications")}
          className={cn(
            "flex h-8 items-center gap-2 rounded px-3 text-sm transition-colors",
            activeView === "publications" ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <LibraryIcon className="size-3.5" aria-hidden />
          Publications
        </button>
      </nav>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <ThemeToggle value={theme} onChange={onThemeChange} />
        {activeView === "posts" ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={onSync} disabled={isSyncing}>
                  <RefreshCwIcon data-icon="inline-start" className={cn(isSyncing && "animate-spin")} />
                  <span className="sr-only">Sync publications</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sync publications</TooltipContent>
            </Tooltip>
            <NewDraftDialog publications={publications} onCreate={onCreateDraft} />
            <Button size="sm" onClick={onPublish} disabled={!canPublish || isPublishing}>
              <RocketIcon data-icon="inline-start" className={cn(isPublishing && "animate-pulse")} />
              {isPublishing ? (isUpdating ? "Updating…" : "Publishing…") : (isUpdating ? "Update" : "Publish")}
            </Button>
          </>
        ) : null}
        <Button variant="outline" size="sm" onClick={onLogOut} disabled={isLoggingOut}>
          <LogOutIcon data-icon="inline-start" />
          {isLoggingOut ? "Logging out…" : "Log out"}
        </Button>
      </div>
    </header>
  );
}

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const isDark = value === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const Icon = isDark ? SunIcon : MoonIcon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-pressed={isDark}
          onClick={() => onChange(nextTheme)}
        >
          <Icon data-icon="inline-start" />
          <span className="sr-only">{isDark ? "Switch to light theme" : "Switch to dark theme"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? "Light theme" : "Dark theme"}</TooltipContent>
    </Tooltip>
  );
}
