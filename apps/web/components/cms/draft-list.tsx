"use client";

import * as React from "react";
import { BookOpenIcon, CalendarClockIcon, PencilIcon, SearchIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PublicationIcon } from "@/components/cms/publication-icon";
import { UserAppearanceCard } from "@/components/cms/user-appearance-card";
import { draftActivityDate } from "@/lib/cms-data";
import type { FontPreference } from "@/lib/preferences";
import type { Draft, DraftStatus, LinkedAccount, Publication } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DraftListTab = "drafts" | "scheduled" | "published";
export type DraftListGrouping = "all" | "publication";

const statusVariant: Record<DraftStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  publishing: "secondary",
  published: "default",
  failed: "destructive",
};
const sideTabsListClassName = "grid w-full grid-cols-3 gap-1 p-1";
const groupingTabsListClassName = "grid w-full grid-cols-2 gap-1 p-1";
const sideTabsTriggerClassName = "min-w-0 px-1 text-center leading-none";
const sideTabsTriggerStyle: React.CSSProperties = { fontSize: "clamp(0.75rem, 0.95vw, 0.875rem)" };

function draftActivityTimestamp(draft: Draft) {
  return parseISO(draftActivityDate(draft)).getTime();
}

export function DraftList({
  drafts,
  publications,
  activeTab,
  grouping,
  account,
  fontPreference,
  boldText,
  smallText,
  selectedDraftID,
  search,
  onTabChange,
  onGroupingChange,
  onFontPreferenceChange,
  onBoldTextChange,
  onSmallTextChange,
  onSearch,
  onSelectDraft,
  onChangePublication,
  onEditSchedule,
  onDelete,
  onRevert,
}: {
  drafts: Draft[];
  publications: Publication[];
  activeTab: DraftListTab;
  grouping: DraftListGrouping;
  account?: LinkedAccount;
  fontPreference: FontPreference;
  boldText: boolean;
  smallText: boolean;
  selectedDraftID?: string;
  search: string;
  onTabChange: (value: DraftListTab) => void;
  onGroupingChange: (value: DraftListGrouping) => void;
  onFontPreferenceChange: (preference: FontPreference) => void;
  onBoldTextChange: (enabled: boolean) => void;
  onSmallTextChange: (enabled: boolean) => void;
  onSearch: (value: string) => void;
  onSelectDraft: (id: string) => void;
  onChangePublication: (draft: Draft) => void;
  onEditSchedule: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
  onRevert: (draft: Draft) => void;
}) {
  const publicationByURI = new Map(publications.map((publication) => [publication.uri, publication]));
  const publicationGroups = publications
    .map((publication) => ({
      publication,
      drafts: drafts.filter((draft) => draft.publicationURI === publication.uri),
    }))
    .filter((group) => group.drafts.length)
    .sort((left, right) => draftActivityTimestamp(right.drafts[0]!) - draftActivityTimestamp(left.drafts[0]!));

  return (
    <section className="hidden min-h-0 border-r xl:flex xl:flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b p-2">
        <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as DraftListTab)}>
          <TabsList className={sideTabsListClassName}>
            <TabsTrigger value="drafts" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Drafts</span>
            </TabsTrigger>
            <TabsTrigger value="scheduled" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Scheduled</span>
            </TabsTrigger>
            <TabsTrigger value="published" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Published</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={grouping} onValueChange={(value) => onGroupingChange(value as DraftListGrouping)}>
          <TabsList className={groupingTabsListClassName}>
            <TabsTrigger value="all" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">All posts</span>
            </TabsTrigger>
            <TabsTrigger value="publication" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">By publication</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex h-9 items-center gap-2">
          <SearchIcon className="text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search"
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {drafts.length ? (
          grouping === "all" ? (
            drafts.map((draft) => (
              <DraftListItem
                key={draft.id}
                draft={draft}
                publication={publicationByURI.get(draft.publicationURI)}
                selected={draft.id === selectedDraftID}
                onSelect={onSelectDraft}
                onChangePublication={onChangePublication}
                onEditSchedule={onEditSchedule}
                onDelete={onDelete}
                onRevert={onRevert}
              />
            ))
          ) : (
            <div className="space-y-4">
              {publicationGroups.map(({ publication, drafts: publicationDrafts }) => (
                <section key={publication.uri} aria-label={publication.name}>
                  <div className="text-muted-foreground flex items-center gap-2 px-3 pb-1.5 text-xs font-medium">
                    <PublicationIcon publication={publication} className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate">{publication.name}</span>
                    <span>{publicationDrafts.length}</span>
                  </div>
                  {publicationDrafts.map((draft) => (
                    <DraftListItem
                      key={draft.id}
                      draft={draft}
                      publication={publication}
                      selected={draft.id === selectedDraftID}
                      onSelect={onSelectDraft}
                      onChangePublication={onChangePublication}
                      onEditSchedule={onEditSchedule}
                      onDelete={onDelete}
                      onRevert={onRevert}
                    />
                  ))}
                </section>
              ))}
            </div>
          )
        ) : (
          <Empty className="min-h-40">
            <EmptyTitle>No articles</EmptyTitle>
            <EmptyDescription>No articles match this status and search.</EmptyDescription>
          </Empty>
        )}
      </div>
      <UserAppearanceCard
        account={account}
        fontPreference={fontPreference}
        boldText={boldText}
        smallText={smallText}
        onFontPreferenceChange={onFontPreferenceChange}
        onBoldTextChange={onBoldTextChange}
        onSmallTextChange={onSmallTextChange}
      />
    </section>
  );
}

function DraftListItem({
  draft,
  publication,
  selected,
  onSelect,
  onChangePublication,
  onEditSchedule,
  onDelete,
  onRevert,
}: {
  draft: Draft;
  publication?: Publication;
  selected: boolean;
  onSelect: (id: string) => void;
  onChangePublication: (draft: Draft) => void;
  onEditSchedule: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
  onRevert: (draft: Draft) => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(draft.id)}
          className={cn(
            "hover:bg-accent flex w-full flex-col gap-2 rounded-md p-3 text-left transition-colors",
            selected && "bg-accent",
          )}
        >
          <div className="flex w-full min-w-0 items-start justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{draft.title}</span>
            <Badge variant={statusVariant[draft.status]}>{draft.status}</Badge>
          </div>
          <span className="text-muted-foreground line-clamp-2 text-xs">{draft.excerpt || draft.plaintext || "No excerpt yet"}</span>
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            {publication ? <PublicationChip publication={publication} /> : <span />}
            <time className="text-muted-foreground shrink-0 text-[11px]" dateTime={draftActivityDate(draft)}>
              {format(parseISO(draftActivityDate(draft)), "MMM d")}
            </time>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {draft.status === "draft" || draft.status === "failed" ? (
          <ContextMenuItem onSelect={() => onChangePublication(draft)}>
            <BookOpenIcon />
            Change publication
          </ContextMenuItem>
        ) : null}
        {draft.status === "scheduled" ? (
          <>
            <ContextMenuItem onSelect={() => onEditSchedule(draft)}>
              <CalendarClockIcon />
              Edit scheduled time
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onRevert(draft)}>
              <Undo2Icon />
              Revert to draft
            </ContextMenuItem>
          </>
        ) : null}
        {draft.status === "published" ? (
          <>
            <ContextMenuItem onSelect={() => onSelect(draft.id)}>
              <PencilIcon />
              Edit
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onRevert(draft)}>
              <Undo2Icon />
              Revert to draft
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(draft)}>
          <Trash2Icon />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PublicationChip({ publication }: { publication: Publication }) {
  return (
    <span className="border-border bg-background text-muted-foreground flex min-w-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]">
      <PublicationIcon publication={publication} className="size-3" />
      <span className="truncate">{publication.name}</span>
    </span>
  );
}
