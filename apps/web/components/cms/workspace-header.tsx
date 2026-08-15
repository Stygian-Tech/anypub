"use client";

import {
  ArrowLeftIcon,
  BookOpenIcon,
  LibraryIcon,
  LogOutIcon,
  MessageSquareTextIcon,
  MoonIcon,
  RefreshCwIcon,
  RocketIcon,
  Settings2Icon,
  SunIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NewDraftDialog } from "@/components/cms/post-dialogs";
import { UserAppearanceCard } from "@/components/cms/user-appearance-card";
import type { FontPreference, ThemePreference } from "@/lib/preferences";
import type { LinkedAccount, Publication } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { MobileWorkspacePane, WorkspaceView } from "@/lib/workspace-navigation";

export function WorkspaceHeader({
  activeView,
  mobilePane,
  activeDraftTitle,
  account,
  theme,
  fontPreference,
  boldText,
  smallText,
  publications,
  isSyncing,
  isPublishing,
  isUpdating,
  isLoggingOut,
  canPublish,
  onThemeChange,
  onFontPreferenceChange,
  onBoldTextChange,
  onSmallTextChange,
  onSync,
  onCreateDraft,
  onPublish,
  onLogOut,
  onViewChange,
  onMobilePaneChange,
  onBackToPosts,
}: {
  activeView: WorkspaceView;
  mobilePane: MobileWorkspacePane;
  activeDraftTitle?: string;
  account?: LinkedAccount;
  theme: ThemePreference;
  fontPreference: FontPreference;
  boldText: boolean;
  smallText: boolean;
  publications: Publication[];
  isSyncing: boolean;
  isPublishing: boolean;
  isUpdating: boolean;
  isLoggingOut: boolean;
  canPublish: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onFontPreferenceChange: (font: FontPreference) => void;
  onBoldTextChange: (enabled: boolean) => void;
  onSmallTextChange: (enabled: boolean) => void;
  onSync: () => void;
  onCreateDraft: (publicationURI: string) => Promise<boolean>;
  onPublish: () => void;
  onLogOut: () => void;
  onViewChange: (view: WorkspaceView) => void;
  onMobilePaneChange: (pane: Exclude<MobileWorkspacePane, "list">) => void;
  onBackToPosts: () => void;
}) {
  const mobileEditing = activeView === "posts" && mobilePane !== "list" && Boolean(activeDraftTitle);

  return (
    <header className="grid min-h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2 xl:min-h-16 xl:grid-cols-[minmax(180px,1fr)_auto_minmax(320px,1fr)] xl:gap-3 xl:px-4 xl:py-0">
      <div className="min-w-0">
        <div className="hidden xl:block">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">AnyPub</div>
            <Badge variant="accent" className="uppercase tracking-wide">Alpha</Badge>
          </div>
          <div className="text-muted-foreground truncate text-xs">standard.site CMS</div>
        </div>
        <div className="flex min-w-0 items-center gap-1 xl:hidden">
          {mobileEditing ? (
            <Button variant="ghost" size="icon" aria-label="Back to posts" onClick={onBackToPosts}>
              <ArrowLeftIcon />
            </Button>
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {mobileEditing ? activeDraftTitle : mobileViewTitle(activeView)}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {mobileEditing ? "Editing post" : activeView === "posts" ? "AnyPub · Alpha" : "standard.site CMS"}
            </div>
          </div>
        </div>
      </div>

      <WorkspaceNavigation activeView={activeView} onViewChange={onViewChange} />

      <div className="flex min-w-0 items-center justify-end gap-2">
        <div className="hidden xl:block"><ThemeToggle value={theme} onChange={onThemeChange} /></div>
        {activeView === "posts" ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button className="hidden xl:inline-flex" variant="outline" size="icon" onClick={onSync} disabled={isSyncing}>
                  <RefreshCwIcon data-icon="inline-start" className={cn(isSyncing && "animate-spin")} />
                  <span className="sr-only">Sync publications</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sync publications</TooltipContent>
            </Tooltip>
            <NewDraftDialog
              publications={publications}
              onCreate={onCreateDraft}
            />
            <Button className="hidden xl:inline-flex" size="sm" onClick={onPublish} disabled={!canPublish || isPublishing}>
              <RocketIcon data-icon="inline-start" className={cn(isPublishing && "animate-pulse")} />
              {isPublishing ? (isUpdating ? "Updating…" : "Publishing…") : (isUpdating ? "Update" : "Publish")}
            </Button>
          </>
        ) : null}
        <Button className="hidden xl:inline-flex" variant="outline" size="sm" onClick={onLogOut} disabled={isLoggingOut}>
          <LogOutIcon data-icon="inline-start" />
          {isLoggingOut ? "Logging out…" : "Log out"}
        </Button>
        <MobileAccountSheet
          account={account}
          theme={theme}
          fontPreference={fontPreference}
          boldText={boldText}
          smallText={smallText}
          isSyncing={isSyncing}
          isLoggingOut={isLoggingOut}
          onThemeChange={onThemeChange}
          onFontPreferenceChange={onFontPreferenceChange}
          onBoldTextChange={onBoldTextChange}
          onSmallTextChange={onSmallTextChange}
          onSync={onSync}
          onLogOut={onLogOut}
        />
      </div>

      {mobileEditing ? (
        <nav aria-label="Post editor" className="col-span-2 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 xl:hidden">
          {(["write", "details", "schedule"] as const).map((pane) => (
            <button
              key={pane}
              type="button"
              aria-current={mobilePane === pane ? "page" : undefined}
              onClick={() => onMobilePaneChange(pane)}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-md px-2 text-sm font-medium capitalize transition-colors",
                mobilePane === pane ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {pane}
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function WorkspaceNavigation({
  activeView,
  onViewChange,
}: {
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}) {
  const views = [
    { value: "posts", label: "Posts", icon: BookOpenIcon },
    { value: "publications", label: "Publications", icon: LibraryIcon },
    { value: "feedback", label: "Feedback", icon: MessageSquareTextIcon },
  ] as const;

  return (
    <nav aria-label="Workspace" className="bg-muted hidden w-fit rounded-md p-1 xl:flex">
      {views.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-current={activeView === value ? "page" : undefined}
          onClick={() => onViewChange(value)}
          className={cn(
            "flex h-8 items-center gap-2 rounded px-3 text-sm transition-colors",
            activeView === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  );
}

function mobileViewTitle(view: WorkspaceView) {
  return view === "posts" ? "Posts" : view === "publications" ? "Publications" : "Feedback";
}

function MobileAccountSheet({
  account,
  theme,
  fontPreference,
  boldText,
  smallText,
  isSyncing,
  isLoggingOut,
  onThemeChange,
  onFontPreferenceChange,
  onBoldTextChange,
  onSmallTextChange,
  onSync,
  onLogOut,
}: {
  account?: LinkedAccount;
  theme: ThemePreference;
  fontPreference: FontPreference;
  boldText: boolean;
  smallText: boolean;
  isSyncing: boolean;
  isLoggingOut: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onFontPreferenceChange: (font: FontPreference) => void;
  onBoldTextChange: (enabled: boolean) => void;
  onSmallTextChange: (enabled: boolean) => void;
  onSync: () => void;
  onLogOut: () => void;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="xl:hidden" variant="outline" size="icon" aria-label="Account and appearance">
          <Settings2Icon />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[min(90vw,24rem)] flex-col overflow-y-auto p-0">
        <SheetHeader className="border-b pr-16">
          <SheetTitle>Account & appearance</SheetTitle>
          <SheetDescription>Manage the editor display and connected account.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 p-4">
          <UserAppearanceCard
            account={account}
            fontPreference={fontPreference}
            boldText={boldText}
            smallText={smallText}
            onFontPreferenceChange={onFontPreferenceChange}
            onBoldTextChange={onBoldTextChange}
            onSmallTextChange={onSmallTextChange}
          />
          <Button variant="outline" className="justify-start" onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <SunIcon data-icon="inline-start" /> : <MoonIcon data-icon="inline-start" />}
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </Button>
          <Button variant="outline" className="justify-start" onClick={onSync} disabled={isSyncing}>
            <RefreshCwIcon data-icon="inline-start" className={cn(isSyncing && "animate-spin")} />
            {isSyncing ? "Syncing publications…" : "Sync publications"}
          </Button>
          <Button variant="outline" className="justify-start" onClick={onLogOut} disabled={isLoggingOut}>
            <LogOutIcon data-icon="inline-start" />
            {isLoggingOut ? "Logging out…" : "Log out"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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
        <Button variant="outline" size="icon" aria-pressed={isDark} onClick={() => onChange(nextTheme)}>
          <Icon data-icon="inline-start" />
          <span className="sr-only">{isDark ? "Switch to light theme" : "Switch to dark theme"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? "Light theme" : "Dark theme"}</TooltipContent>
    </Tooltip>
  );
}
