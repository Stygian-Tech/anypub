"use client";

import { MoonIcon, RefreshCwIcon, RocketIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NewDraftDialog } from "@/components/cms/post-dialogs";
import type { ThemePreference } from "@/lib/preferences";
import type { Publication } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({
  theme,
  publications,
  isSyncing,
  canPublish,
  onThemeChange,
  onSync,
  onCreateDraft,
  onPublish,
}: {
  theme: ThemePreference;
  publications: Publication[];
  isSyncing: boolean;
  canPublish: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onSync: () => void;
  onCreateDraft: (publicationURI: string) => Promise<boolean>;
  onPublish: () => void;
}) {
  return (
    <header className="grid min-h-16 shrink-0 grid-cols-1 items-center gap-3 border-b px-4 py-2 lg:grid-cols-[minmax(180px,1fr)_minmax(320px,1fr)] lg:py-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">AnyPub</div>
        <div className="text-muted-foreground truncate text-xs">standard.site CMS</div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <ThemeToggle value={theme} onChange={onThemeChange} />
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
        <Button size="sm" onClick={onPublish} disabled={!canPublish}>
          <RocketIcon data-icon="inline-start" />
          Publish
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
