"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import {
  BaselineIcon,
  BoldIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ClockIcon,
  FileTextIcon,
  GripVerticalIcon,
  ImageIcon,
  LeafIcon,
  MoonIcon,
  NewspaperIcon,
  NotebookTextIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SaveIcon,
  SearchIcon,
  SunIcon,
  TypeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { calendarItemsFromDrafts, seedAccounts, seedDrafts, seedPublications } from "@/lib/cms-data";
import {
  compactMarkdownBlocks,
  isListMarkdownBlock,
  joinMarkdownBlocks,
  moveMarkdownBlock,
  parseMarkdownBlock,
  parseMarkdownBlocks,
  setMarkdownBlockListLevel,
  splitMarkdownBlockAtCursor,
  type MarkdownBlock,
} from "@/lib/markdown-blocks";
import {
  columnLayoutBounds,
  defaultColumnLayout,
  fontLabel,
  isDarkTheme,
  resolveFontPreference,
  resolveThemePreference,
  sanitizeColumnLayout,
  type ColumnLayout,
  type FontPreference,
  type ThemePreference,
} from "@/lib/preferences";
import type { Draft, DraftStatus, LinkedAccount, Publication } from "@/lib/types";
import { markdownToPlaintext, validateDraft } from "@/lib/validation";
import { cn } from "@/lib/utils";

const statusVariant: Record<DraftStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  publishing: "secondary",
  published: "default",
  failed: "destructive",
};

const columnLayoutStorageKey = "anypub:column-layout";
const themeStorageKey = "anypub:theme";
const fontStorageKey = "anypub:font";
const boldTextStorageKey = "anypub:bold-text";
const resizeStep = 16;
const sideTabsListClassName = "grid w-full grid-cols-3 gap-1 p-1";
const sideTabsTriggerClassName =
  "min-w-0 px-1 text-center leading-none";
const sideTabsTriggerStyle: React.CSSProperties = {
  fontSize: "clamp(0.75rem, 0.95vw, 0.875rem)",
};
type ColumnKey = keyof ColumnLayout;
type DraftListTab = "drafts" | "scheduled" | "published";

const activeSeedAccount = seedAccounts[0];
const initialAccountDID = activeSeedAccount?.did ?? "";
const initialPublicationURI =
  seedPublications.find((publication) => publication.accountDID === initialAccountDID)?.uri ?? "";
const initialDraftID =
  seedDrafts.find((draft) => draft.publicationURI === initialPublicationURI)?.id ?? seedDrafts[0]?.id ?? "";
const initialDraft = seedDrafts.find((draft) => draft.id === initialDraftID);
const initialDraftListTab: DraftListTab =
  initialDraft?.status === "scheduled"
    ? "scheduled"
    : initialDraft?.status === "published"
      ? "published"
      : "drafts";

function readColumnLayout() {
  if (typeof window === "undefined") {
    return defaultColumnLayout;
  }

  try {
    const stored = window.localStorage.getItem(columnLayoutStorageKey);
    return sanitizeColumnLayout(stored ? JSON.parse(stored) : undefined);
  } catch {
    return defaultColumnLayout;
  }
}

function readThemePreference() {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored ? resolveThemePreference(stored) : "light";
}

function readFontPreference() {
  if (typeof window === "undefined") {
    return "sans";
  }
  return resolveFontPreference(window.localStorage.getItem(fontStorageKey));
}

function readBoldTextPreference() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(boldTextStorageKey) === "1";
}

function applyThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }

  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldUseDarkTheme = isDarkTheme(preference, systemPrefersDark);
  document.documentElement.classList.toggle("dark", shouldUseDarkTheme);
  document.documentElement.dataset.theme = shouldUseDarkTheme ? "dark" : "light";
  document.documentElement.style.colorScheme = shouldUseDarkTheme ? "dark" : "light";
  window.localStorage.setItem(themeStorageKey, preference);
}

function applyFontPreference(preference: FontPreference) {
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.dataset.font = preference;
  if (preference === "sans") {
    window.localStorage.removeItem(fontStorageKey);
  } else {
    window.localStorage.setItem(fontStorageKey, preference);
  }
}

function applyBoldTextPreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.dataset.boldText = enabled ? "true" : "false";
  if (enabled) {
    window.localStorage.setItem(boldTextStorageKey, "1");
  } else {
    window.localStorage.removeItem(boldTextStorageKey);
  }
}

export function CmsShell() {
  const [publications] = React.useState(seedPublications);
  const [drafts, setDrafts] = React.useState(seedDrafts);
  const activeAccount = activeSeedAccount;
  const activeAccountDID = activeAccount?.did ?? "";
  const [selectedPublicationURI, setSelectedPublicationURI] = React.useState(initialPublicationURI);
  const [selectedDraftID, setSelectedDraftID] = React.useState(initialDraftID);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [draftListTab, setDraftListTab] = React.useState<DraftListTab>(initialDraftListTab);
  const [scheduledDate, setScheduledDate] = React.useState<Date | undefined>(() => {
    const draft = seedDrafts[0];
    return draft?.scheduledAt ? parseISO(draft.scheduledAt) : undefined;
  });
  const [themePreference, setThemePreference] = React.useState<ThemePreference>("light");
  const [fontPreference, setFontPreference] = React.useState<FontPreference>("sans");
  const [boldText, setBoldText] = React.useState(false);
  const [columnLayout, setColumnLayout] = React.useState<ColumnLayout>(defaultColumnLayout);
  const [preferencesHydrated, setPreferencesHydrated] = React.useState(false);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setThemePreference(readThemePreference());
      setFontPreference(readFontPreference());
      setBoldText(readBoldTextPreference());
      setColumnLayout(readColumnLayout());
      setPreferencesHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  React.useEffect(() => {
    if (!preferencesHydrated) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      applyThemePreference(themePreference);
    }

    applyTheme();

    if (themePreference !== "system") {
      return;
    }

    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [preferencesHydrated, themePreference]);

  React.useEffect(() => {
    if (!preferencesHydrated) {
      return;
    }

    applyFontPreference(fontPreference);
    applyBoldTextPreference(boldText);
  }, [boldText, fontPreference, preferencesHydrated]);

  React.useEffect(() => {
    if (!preferencesHydrated) {
      return;
    }

    window.localStorage.setItem(columnLayoutStorageKey, JSON.stringify(columnLayout));
  }, [columnLayout, preferencesHydrated]);

  const accountPublications = React.useMemo(
    () => publications.filter((publication) => publication.accountDID === activeAccountDID),
    [activeAccountDID, publications],
  );

  const selectedPublication = React.useMemo(
    () => publications.find((publication) => publication.uri === selectedPublicationURI) ?? accountPublications[0],
    [accountPublications, publications, selectedPublicationURI],
  );

  const visibleDrafts = React.useMemo(() => {
    return drafts.filter((draft) => {
      const matchesPublication = draft.publicationURI === selectedPublication?.uri;
      const matchesTab =
        (draftListTab === "drafts" && (draft.status === "draft" || draft.status === "failed" || draft.status === "publishing")) ||
        (draftListTab === "scheduled" && draft.status === "scheduled") ||
        (draftListTab === "published" && draft.status === "published");
      const matchesSearch =
        !search ||
        draft.title.toLowerCase().includes(search.toLowerCase()) ||
        draft.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      return matchesPublication && matchesTab && matchesSearch;
    });
  }, [draftListTab, drafts, search, selectedPublication?.uri]);

  const activeDraft = React.useMemo(() => {
    return visibleDrafts.find((draft) => draft.id === selectedDraftID) ?? visibleDrafts[0];
  }, [selectedDraftID, visibleDrafts]);

  const validation = React.useMemo(() => {
    if (!activeDraft) {
      return { valid: false, errors: {} };
    }
    return validateDraft(activeDraft);
  }, [activeDraft]);

  const calendarItems = React.useMemo(() => calendarItemsFromDrafts(drafts), [drafts]);

  function resizeColumn(key: ColumnKey, delta: number) {
    setColumnLayout((current) =>
      sanitizeColumnLayout({
        ...current,
        [key]: current[key] + delta,
      }),
    );
  }

  function changeThemePreference(preference: ThemePreference) {
    applyThemePreference(preference);
    setThemePreference(preference);
  }

  function changeFontPreference(preference: FontPreference) {
    applyFontPreference(preference);
    setFontPreference(preference);
  }

  function changeBoldText(enabled: boolean) {
    applyBoldTextPreference(enabled);
    setBoldText(enabled);
  }

  function beginColumnResize(
    key: ColumnKey,
    direction: 1 | -1,
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const startX = event.clientX;
    const startWidth = columnLayout[key];
    const ownerDocument = event.currentTarget.ownerDocument;
    const previousCursor = ownerDocument.body.style.cursor;
    const previousUserSelect = ownerDocument.body.style.userSelect;

    ownerDocument.body.style.cursor = "col-resize";
    ownerDocument.body.style.userSelect = "none";

    function finishResize() {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.body.style.userSelect = previousUserSelect;
      ownerDocument.removeEventListener("pointermove", moveResize);
      ownerDocument.removeEventListener("pointerup", finishResize);
      ownerDocument.removeEventListener("pointercancel", finishResize);
    }

    function moveResize(moveEvent: PointerEvent) {
      const delta = (moveEvent.clientX - startX) * direction;
      setColumnLayout((current) =>
        sanitizeColumnLayout({
          ...current,
          [key]: startWidth + delta,
        }),
      );
    }

    ownerDocument.addEventListener("pointermove", moveResize);
    ownerDocument.addEventListener("pointerup", finishResize);
    ownerDocument.addEventListener("pointercancel", finishResize);
  }

  function updateDraft(patch: Partial<Draft>) {
    if (!activeDraft) {
      return;
    }
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== activeDraft.id) {
          return draft;
        }
        const next = {
          ...draft,
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        if (patch.markdown !== undefined) {
          next.plaintext = markdownToPlaintext(patch.markdown);
        }
        return next;
      }),
    );
  }

  function createDraft() {
    if (!selectedPublication) {
      return;
    }
    const next: Draft = {
      id: crypto.randomUUID(),
      accountDID: activeAccountDID,
      publicationURI: selectedPublication.uri,
      publicationURL: selectedPublication.url,
      title: "Untitled article",
      path: "/untitled-article",
      excerpt: "",
      tags: [],
      markdown: "",
      plaintext: "",
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDrafts((current) => [next, ...current]);
    setDraftListTab("drafts");
    setSelectedDraftID(next.id);
  }

  function scheduleDraft() {
    if (!activeDraft || !scheduledDate) {
      return;
    }
    updateDraft({
      status: "scheduled",
      scheduledAt: scheduledDate.toISOString(),
    });
    setDraftListTab("scheduled");
    toast.success("Draft scheduled");
  }

  function publishDraft() {
    if (!activeDraft || !validation.valid) {
      toast.error("Resolve validation before publishing");
      return;
    }
    updateDraft({
      status: "published",
      publishedAt: new Date().toISOString(),
      documentURI: `at://${activeDraft.accountDID}/site.standard.document/${activeDraft.id}`,
      documentCID: "local-preview",
    });
    setDraftListTab("published");
    toast.success("Publish request queued");
  }

  function syncPublications() {
    setIsSyncing(true);
    window.setTimeout(() => {
      setIsSyncing(false);
      toast.success("Publication cache refreshed");
    }, 600);
  }

  function selectPublication(publicationURI: string) {
    const nextDraft = drafts.find((draft) => draft.publicationURI === publicationURI);
    setSelectedPublicationURI(publicationURI);
    setSelectedDraftID(nextDraft?.id ?? "");
    setDraftListTab(
      nextDraft?.status === "scheduled"
        ? "scheduled"
        : nextDraft?.status === "published"
          ? "published"
          : "drafts",
    );
    setScheduledDate(nextDraft?.scheduledAt ? parseISO(nextDraft.scheduledAt) : undefined);
  }

  const shellStyle = {
    "--workbench-columns": `${columnLayout.draftList}px 9px minmax(0,1fr) 9px ${columnLayout.metadataPanel}px`,
  } as React.CSSProperties & {
    "--workbench-columns": string;
  };

  return (
    <TooltipProvider>
      <div className="app-appearance-scope flex h-dvh min-h-0 bg-background text-foreground" style={shellStyle}>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="grid min-h-16 shrink-0 grid-cols-1 items-center gap-3 border-b px-4 py-2 lg:grid-cols-[minmax(180px,1fr)_minmax(220px,340px)_minmax(320px,1fr)] lg:py-0">
            <AnyPubTitle />
            <PublicationHeaderSelect
              publications={accountPublications}
              selectedPublicationURI={selectedPublication?.uri ?? ""}
              onPublicationChange={selectPublication}
            />
            <div className="flex min-w-0 items-center justify-end gap-2">
              <ThemeToggle value={themePreference} onChange={changeThemePreference} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={syncPublications} disabled={isSyncing}>
                    <RefreshCwIcon data-icon="inline-start" className={cn(isSyncing && "animate-spin")} />
                    <span className="sr-only">Sync publications</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sync publications</TooltipContent>
              </Tooltip>
              <Button variant="outline" size="sm" onClick={createDraft}>
                <PlusIcon data-icon="inline-start" />
                New
              </Button>
              <Button size="sm" onClick={publishDraft} disabled={!activeDraft || !validation.valid}>
                <RocketIcon data-icon="inline-start" />
                Publish
              </Button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[var(--workbench-columns)]">
            <DraftList
              drafts={visibleDrafts}
              activeTab={draftListTab}
              account={activeAccount}
              boldText={boldText}
              fontPreference={fontPreference}
              selectedDraftID={activeDraft?.id}
              search={search}
              onTabChange={setDraftListTab}
              onBoldTextChange={changeBoldText}
              onFontPreferenceChange={changeFontPreference}
              onSearch={setSearch}
              onSelectDraft={setSelectedDraftID}
            />
            <ColumnResizeHandle
              className="hidden xl:flex"
              label="Resize draft list"
              value={columnLayout.draftList}
              min={columnLayoutBounds.draftList.min}
              max={columnLayoutBounds.draftList.max}
              onPointerDown={(event) => beginColumnResize("draftList", 1, event)}
              onNudge={(delta) => resizeColumn("draftList", delta)}
            />
            {activeDraft ? (
              <EditorPanel
                draft={activeDraft}
                validation={validation.errors}
                onChange={updateDraft}
                onSave={() => toast.success("Draft saved")}
              />
            ) : (
              <Empty className="m-4">
                <EmptyTitle>No draft selected</EmptyTitle>
                <EmptyDescription>Create a draft to start writing.</EmptyDescription>
              </Empty>
            )}
            <ColumnResizeHandle
              className="hidden xl:flex"
              label="Resize metadata panel"
              value={columnLayout.metadataPanel}
              min={columnLayoutBounds.metadataPanel.min}
              max={columnLayoutBounds.metadataPanel.max}
              onPointerDown={(event) => beginColumnResize("metadataPanel", -1, event)}
              onNudge={(delta) => resizeColumn("metadataPanel", -delta)}
            />
            <RightPanel
              draft={activeDraft}
              selectedPublication={selectedPublication}
              calendarItems={calendarItems}
              scheduledDate={scheduledDate}
              onScheduledDate={setScheduledDate}
              onSchedule={scheduleDraft}
              onDraftChange={updateDraft}
            />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function AnyPubTitle() {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-semibold">AnyPub</div>
      <div className="text-muted-foreground truncate text-xs">standard.site CMS</div>
    </div>
  );
}

function AccountAvatar({
  account,
  className,
}: {
  account?: LinkedAccount;
  className?: string;
}) {
  const displayName = account?.displayName || account?.handle || "No account";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AP";

  return (
    <div
      role={account?.avatarURL ? "img" : undefined}
      aria-label={account?.avatarURL ? `${displayName} profile picture` : undefined}
      className={cn(
        "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-cover bg-center text-sm font-medium",
        className,
      )}
      style={account?.avatarURL ? { backgroundImage: `url(${account.avatarURL})` } : undefined}
    >
      {account?.avatarURL ? null : <span>{initials}</span>}
    </div>
  );
}

const fontOptions: Array<{
  value: FontPreference;
  label: string;
  icon: typeof TypeIcon;
  style: React.CSSProperties;
}> = [
  {
    value: "sans",
    label: "Sans",
    icon: TypeIcon,
    style: { fontFamily: "var(--font-sans-system)" },
  },
  {
    value: "serif",
    label: "Serif",
    icon: BookOpenIcon,
    style: { fontFamily: "var(--font-serif-system)" },
  },
  {
    value: "mono",
    label: "Mono",
    icon: BaselineIcon,
    style: { fontFamily: "var(--font-mono-system)" },
  },
];

function UserAppearanceCard({
  account,
  fontPreference,
  boldText,
  onFontPreferenceChange,
  onBoldTextChange,
}: {
  account?: LinkedAccount;
  fontPreference: FontPreference;
  boldText: boolean;
  onFontPreferenceChange: (preference: FontPreference) => void;
  onBoldTextChange: (enabled: boolean) => void;
}) {
  const displayName = account?.displayName || account?.handle || "No account";
  const handle = account?.handle ? `@${account.handle}` : "OAuth account required";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="user-card"
          className="hover:bg-accent focus-visible:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-3 border-t p-3 text-left outline-none transition-colors focus-visible:ring-2"
        >
          <AccountAvatar account={account} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{displayName}</span>
            <span className="text-muted-foreground block truncate text-xs">{handle}</span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription className="sr-only">Choose the editor font and text weight.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Font</h3>
              <span className="text-muted-foreground text-xs">
                {fontLabel(fontPreference)}
                {boldText ? " + Bold" : ""}
              </span>
            </div>
            <div role="radiogroup" aria-label="Font" className="mt-3 grid gap-2 sm:grid-cols-3">
              {fontOptions.map((option) => {
                const active = option.value === fontPreference;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`font-${option.value}`}
                    onClick={() => onFontPreferenceChange(option.value)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground",
                    )}
                  >
                    <Icon data-icon="inline-start" className="text-primary" />
                    <span
                      className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium text-foreground"
                      style={{ ...option.style, fontWeight: boldText ? 700 : 400 }}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            data-testid="font-bold"
            aria-pressed={boldText}
            onClick={() => onBoldTextChange(!boldText)}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              boldText
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground",
            )}
          >
            <BoldIcon data-icon="inline-start" className="text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Bold Text</span>
            <span className="text-muted-foreground text-xs">{boldText ? "On" : "Off"}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PublicationHeaderSelect({
  publications,
  selectedPublicationURI,
  onPublicationChange,
}: {
  publications: Publication[];
  selectedPublicationURI: string;
  onPublicationChange: (uri: string) => void;
}) {
  const selectedPublication = publications.find((publication) => publication.uri === selectedPublicationURI);

  return (
    <div className="flex min-w-0 justify-center">
      <Select value={selectedPublicationURI} onValueChange={onPublicationChange}>
        <SelectTrigger aria-label="Select blog" className="w-full max-w-[320px]">
          {selectedPublication ? (
            <PublicationPickerLabel publication={selectedPublication} />
          ) : (
            <SelectValue placeholder="Select blog" />
          )}
        </SelectTrigger>
        <SelectContent align="center">
          <SelectGroup>
            {publications.map((publication) => (
              <SelectItem key={publication.uri} value={publication.uri}>
                <PublicationPickerLabel publication={publication} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function PublicationPickerLabel({ publication }: { publication: Publication }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PublicationIcon publication={publication} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight">{publication.name}</span>
        <span className="text-muted-foreground block truncate text-xs leading-tight">
          {publicationHostLabel(publication)}
        </span>
      </span>
    </span>
  );
}

function PublicationIcon({
  publication,
  className,
}: {
  publication: Publication;
  className?: string;
}) {
  const Icon =
    publication.host === "leaflet"
      ? LeafIcon
      : publication.host === "offprint"
        ? NewspaperIcon
        : publication.host === "pckt"
          ? NotebookTextIcon
          : FileTextIcon;

  return (
    <span className={cn("bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border", className)}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function publicationHostLabel(publication: Publication) {
  if (publication.host) {
    return publication.host;
  }

  return "standard.site";
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

function ColumnResizeHandle({
  className,
  label,
  value,
  min,
  max,
  onPointerDown,
  onNudge,
}: {
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="separator"
          tabIndex={0}
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Math.round(value)}
          onPointerDown={onPointerDown}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              onNudge(-resizeStep);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              onNudge(resizeStep);
            }
          }}
          className={cn(
            "group relative min-h-0 w-[9px] cursor-col-resize items-center justify-center bg-background outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
            className,
          )}
        >
          <span className="h-full w-px bg-border transition-colors group-hover:bg-ring group-focus-visible:bg-ring" />
          <GripVerticalIcon className="text-muted-foreground pointer-events-none absolute size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function DraftList({
  drafts,
  activeTab,
  account,
  fontPreference,
  boldText,
  selectedDraftID,
  search,
  onTabChange,
  onFontPreferenceChange,
  onBoldTextChange,
  onSearch,
  onSelectDraft,
}: {
  drafts: Draft[];
  activeTab: DraftListTab;
  account?: LinkedAccount;
  fontPreference: FontPreference;
  boldText: boolean;
  selectedDraftID?: string;
  search: string;
  onTabChange: (value: DraftListTab) => void;
  onFontPreferenceChange: (preference: FontPreference) => void;
  onBoldTextChange: (enabled: boolean) => void;
  onSearch: (value: string) => void;
  onSelectDraft: (id: string) => void;
}) {
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
          drafts.map((draft) => (
            <button
              key={draft.id}
              onClick={() => onSelectDraft(draft.id)}
              className={cn(
                "hover:bg-accent flex w-full flex-col gap-2 rounded-md p-3 text-left transition-colors",
                draft.id === selectedDraftID && "bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{draft.title}</span>
                <Badge variant={statusVariant[draft.status]}>{draft.status}</Badge>
              </div>
              <span className="text-muted-foreground line-clamp-2 text-xs">{draft.excerpt || draft.plaintext || "No excerpt yet"}</span>
            </button>
          ))
        ) : (
          <Empty className="min-h-40">
            <EmptyTitle>No articles</EmptyTitle>
            <EmptyDescription>This publication has no matching articles.</EmptyDescription>
          </Empty>
        )}
      </div>
      <UserAppearanceCard
        account={account}
        fontPreference={fontPreference}
        boldText={boldText}
        onFontPreferenceChange={onFontPreferenceChange}
        onBoldTextChange={onBoldTextChange}
      />
    </section>
  );
}

function EditorPanel({
  draft,
  validation,
  onChange,
  onSave,
}: {
  draft: Draft;
  validation: Record<string, string>;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant[draft.status]}>{draft.status}</Badge>
          <span className="text-muted-foreground text-xs">{draft.path}</span>
        </div>
        <Button size="sm" onClick={onSave}>
          <SaveIcon data-icon="inline-start" />
          Save
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full max-w-4xl flex-col">
          <div className="border-b p-4">
            <Field data-invalid={Boolean(validation.title)}>
              <FieldLabel htmlFor="title">Title</FieldLabel>
              <Input
                id="title"
                value={draft.title}
                aria-invalid={Boolean(validation.title)}
                onChange={(event) => onChange({ title: event.target.value })}
              />
              {validation.title ? <FieldDescription>{validation.title}</FieldDescription> : null}
            </Field>
          </div>
          <MarkdownBlockEditor
            key={draft.id}
            value={draft.markdown}
            invalid={Boolean(validation.markdown)}
            onChange={(markdown) => onChange({ markdown })}
          />
        </div>
      </div>
    </section>
  );
}

function MarkdownBlockEditor({
  value,
  invalid,
  onChange,
}: {
  value: string;
  invalid: boolean;
  onChange: (markdown: string) => void;
}) {
  const [blocks, setBlocks] = React.useState(() => parseMarkdownBlocks(value));
  const [activeBlockIndex, setActiveBlockIndex] = React.useState<number | null>(null);
  const [draggedBlockIndex, setDraggedBlockIndex] = React.useState<number | null>(null);
  const [dragOverBlockIndex, setDragOverBlockIndex] = React.useState<number | null>(null);
  const dragStateRef = React.useRef<{
    fromIndex: number;
    overIndex: number | null;
    startX: number;
    targetListLevel?: number;
  } | null>(null);

  function commitBlocks(nextBlocks: MarkdownBlock[], preserveEmptyIndexes?: number | number[]) {
    const preservedIndexes = new Set(
      Array.isArray(preserveEmptyIndexes)
        ? preserveEmptyIndexes
        : preserveEmptyIndexes === undefined
          ? []
          : [preserveEmptyIndexes],
    );
    const committedBlocks = nextBlocks.filter((block, index) => block.source.trim() || preservedIndexes.has(index));

    setBlocks(committedBlocks);
    onChange(joinMarkdownBlocks(committedBlocks));
  }

  function deleteEmptyBlocks() {
    const compactedBlocks = compactMarkdownBlocks(blocks);
    setBlocks(compactedBlocks);
    onChange(joinMarkdownBlocks(compactedBlocks));
    setActiveBlockIndex(null);
  }

  function setActiveBlock(index: number) {
    const compactedBlocks = compactMarkdownBlocks(blocks);
    if (compactedBlocks.length !== blocks.length) {
      setBlocks(compactedBlocks);
      onChange(joinMarkdownBlocks(compactedBlocks));
    }
    setActiveBlockIndex(Math.min(index, compactedBlocks.length - 1));
  }

  function addEmptyBlock(afterIndex: number) {
    const compactedBlocks = compactMarkdownBlocks(blocks);
    const boundedAfterIndex = Math.min(Math.max(afterIndex, -1), compactedBlocks.length - 1);
    const insertAt = boundedAfterIndex + 1;
    const nextBlocks = [...compactedBlocks];
    nextBlocks.splice(insertAt, 0, parseMarkdownBlock(""));

    setBlocks(nextBlocks);
    onChange(joinMarkdownBlocks(nextBlocks));
    setActiveBlockIndex(insertAt);
  }

  function updateBlock(index: number, nextValue: string) {
    updateParsedBlock(index, parseMarkdownBlock(nextValue));
  }

  function updateParsedBlock(index: number, nextBlock: MarkdownBlock) {
    const nextBlocks = [...blocks];
    nextBlocks[index] = nextBlock;
    commitBlocks(nextBlocks, index);
  }

  function moveBlock(fromIndex: number, toIndex: number, targetListLevel?: number) {
    const compactedBlocks = compactMarkdownBlocks(blocks);
    if (
      fromIndex < 0 ||
      fromIndex >= compactedBlocks.length ||
      toIndex < 0 ||
      toIndex >= compactedBlocks.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const movedBlocks = moveMarkdownBlock(blocks, fromIndex, toIndex, { targetListLevel });
    setBlocks(movedBlocks);
    onChange(joinMarkdownBlocks(movedBlocks));
    setActiveBlockIndex((currentIndex) => reindexAfterMove(currentIndex, fromIndex, toIndex));
  }

  function startDraggingBlock(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus();
    const draggedBlock = blocks[index];
    dragStateRef.current = {
      fromIndex: index,
      overIndex: index,
      startX: event.clientX,
      targetListLevel: draggedBlock && isListMarkdownBlock(draggedBlock) ? draggedBlock.listLevel : undefined,
    };
    setDraggedBlockIndex(index);
    setDragOverBlockIndex(index);

    const ownerDocument = event.currentTarget.ownerDocument;

    function updateDragTarget(pointerEvent: PointerEvent) {
      const target = ownerDocument.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      const row = target?.closest<HTMLElement>("[data-block-index]");
      const targetIndex = Number(row?.dataset.blockIndex);
      if (!Number.isInteger(targetIndex)) {
        return;
      }

      const currentDragState = dragStateRef.current;
      const targetListLevel = resolveDraggedListLevel(index, targetIndex, pointerEvent.clientX, currentDragState?.startX);
      dragStateRef.current = { fromIndex: index, overIndex: targetIndex, startX: currentDragState?.startX ?? event.clientX, targetListLevel };
      setDragOverBlockIndex(targetIndex);
    }

    function finishDragging(pointerEvent: PointerEvent) {
      updateDragTarget(pointerEvent);
      const dragState = dragStateRef.current;
      if (dragState?.overIndex !== null && dragState?.overIndex !== undefined) {
        moveBlock(dragState.fromIndex, dragState.overIndex, dragState.targetListLevel);
      }

      dragStateRef.current = null;
      setDraggedBlockIndex(null);
      setDragOverBlockIndex(null);
      ownerDocument.removeEventListener("pointermove", updateDragTarget);
      ownerDocument.removeEventListener("pointerup", finishDragging);
      ownerDocument.removeEventListener("pointercancel", cancelDragging);
    }

    function cancelDragging() {
      dragStateRef.current = null;
      setDraggedBlockIndex(null);
      setDragOverBlockIndex(null);
      ownerDocument.removeEventListener("pointermove", updateDragTarget);
      ownerDocument.removeEventListener("pointerup", finishDragging);
      ownerDocument.removeEventListener("pointercancel", cancelDragging);
    }

    ownerDocument.addEventListener("pointermove", updateDragTarget);
    ownerDocument.addEventListener("pointerup", finishDragging);
    ownerDocument.addEventListener("pointercancel", cancelDragging);
  }

  function resolveDraggedListLevel(fromIndex: number, toIndex: number, clientX: number, startX?: number) {
    const draggedBlock = blocks[fromIndex];
    if (!draggedBlock || !isListMarkdownBlock(draggedBlock)) {
      return undefined;
    }

    if (toIndex <= 0) {
      return 0;
    }

    const levelDelta = Math.round((clientX - (startX ?? clientX)) / 48);
    return Math.max(0, Math.min(4, draggedBlock.listLevel + levelDelta));
  }

  function changeListLevel(index: number, delta: number) {
    const block = blocks[index];
    if (!block || !isListMarkdownBlock(block)) {
      return false;
    }

    updateParsedBlock(index, setMarkdownBlockListLevel(block, block.listLevel + delta));
    return true;
  }

  function insertTabText(index: number, event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    const nextValue = `${target.value.slice(0, selectionStart)}\t${target.value.slice(selectionEnd)}`;
    updateBlock(index, nextValue);
  }

  function insertBlockBreak(index: number, event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const block = blocks[index];
    if (!block) {
      return;
    }

    const target = event.currentTarget;
    const nextBlocks = [...blocks];
    const splitBlocks = splitMarkdownBlockAtCursor(block, target.selectionStart, target.selectionEnd);

    nextBlocks.splice(index, 1, ...splitBlocks);
    commitBlocks(nextBlocks, [index, index + 1]);
    setActiveBlockIndex(index + 1);
  }

  return (
    <Field data-invalid={invalid} className="min-h-0 flex-1">
      <FieldLabel htmlFor="markdown-block-0" className="sr-only">Markdown</FieldLabel>
      <div data-testid="markdown-block-editor" className="flex min-h-[64vh] flex-col px-0 py-4">
        {blocks.map((block, index) => {
          const isActive = index === activeBlockIndex;
          const isListItem = isListMarkdownBlock(block);
          const listLevel = isListItem ? block.listLevel : 0;

          return (
            <div
              key={`${index}-${blocks.length}`}
              data-testid="markdown-block-row"
              data-block-index={index}
              data-list-block={isListItem ? "true" : undefined}
              data-list-level={isListItem ? listLevel : undefined}
              style={{ marginLeft: isListItem && listLevel > 0 ? `${listLevel * 28}px` : undefined }}
              className={cn(
                "group/block relative flex items-start gap-0 transition-colors hover:bg-accent/45 focus-within:bg-accent/45",
                isListItem ? "rounded-sm" : "my-0.5 rounded-md",
                draggedBlockIndex === index && "opacity-50",
                dragOverBlockIndex === index && draggedBlockIndex !== index && "bg-accent/60 ring-ring/30 ring-1",
              )}
            >
              <BlockDragHandle
                index={index}
                block={block}
                onPointerDown={startDraggingBlock}
                onMove={moveBlock}
              />
              {isActive ? (
                <div className="min-w-0 flex-1">
                  <InlineMarkdownBlockTextarea
                    id={`markdown-block-${index}`}
                    value={block.source}
                    invalid={invalid}
                    onBlur={deleteEmptyBlocks}
                    onChange={(nextValue) => updateBlock(index, nextValue)}
                    onKeyDown={(event) => {
                      if (event.key === "Tab") {
                        event.preventDefault();
                        if (event.shiftKey) {
                          if (!changeListLevel(index, -1)) {
                            insertTabText(index, event);
                          }
                          return;
                        }

                        if (isListItem) {
                          changeListLevel(index, 1);
                          return;
                        }

                        if (!block.source.trim()) {
                          updateBlock(index, "\t- ");
                          return;
                        }

                        insertTabText(index, event);
                        return;
                      }

                      if (event.key === "Escape") {
                        event.preventDefault();
                        deleteEmptyBlocks();
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        insertBlockBreak(index, event);
                      }
                    }}
                    compact={isListItem}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="markdown-block-preview"
                  onClick={() => setActiveBlock(index)}
                  className={cn(
                    "hover:bg-accent/70 focus-visible:bg-accent/70 block min-w-0 flex-1 text-left outline-none transition-colors",
                    isListItem ? "rounded-sm py-0 pr-3 pl-0" : "rounded-md py-2 pr-3 pl-0",
                    invalid && !block.source.trim() && "ring-destructive/35 ring-1",
                  )}
                >
                  <MarkdownBlockPreview block={block} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          data-testid="markdown-add-block"
          onClick={() => addEmptyBlock(blocks.length - 1)}
          className="text-muted-foreground hover:bg-accent/60 focus-visible:bg-accent/60 flex min-h-24 w-full items-start gap-2 rounded-md px-3 py-3 text-left text-sm outline-none transition-colors"
        >
          <PlusIcon data-icon="inline-start" />
          Add block
        </button>
      </div>
      {invalid ? <FieldDescription>Markdown body is required.</FieldDescription> : null}
    </Field>
  );
}

function BlockDragHandle({
  index,
  block,
  onPointerDown,
  onMove,
}: {
  index: number;
  block: MarkdownBlock;
  onPointerDown: (index: number, event: React.PointerEvent<HTMLButtonElement>) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  const handleOffset = blockHandleOffset(block);

  return (
    <button
      type="button"
      data-testid="markdown-block-drag-handle"
      aria-label={`Move block ${index + 1}`}
      onPointerDown={(event) => onPointerDown(index, event)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onMove(index, index - 1);
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onMove(index, index + 1);
        }
      }}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md opacity-0 outline-none transition-colors focus-visible:opacity-100 focus-visible:ring-2 active:cursor-grabbing group-hover/block:opacity-100 group-focus-within/block:opacity-100",
      )}
      style={{ marginTop: handleOffset }}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  );
}

function blockHandleOffset(block: MarkdownBlock) {
  const handleSize = 28;
  const contentPaddingTop = isListMarkdownBlock(block) ? 0 : 8;
  const lineHeight = firstLineHeight(block);
  return Math.max(0, contentPaddingTop + lineHeight / 2 - handleSize / 2);
}

function firstLineHeight(block: MarkdownBlock) {
  if (block.kind !== "heading") {
    return 28;
  }

  if (block.headingLevel === 1) {
    return 30;
  }

  if (block.headingLevel === 2) {
    return 25;
  }

  if (block.headingLevel === 3) {
    return 22.5;
  }

  return 20;
}

function reindexAfterMove(currentIndex: number | null, fromIndex: number, toIndex: number) {
  if (currentIndex === null || fromIndex === toIndex || toIndex < 0) {
    return currentIndex;
  }

  if (currentIndex === fromIndex) {
    return toIndex;
  }

  if (fromIndex < toIndex && currentIndex > fromIndex && currentIndex <= toIndex) {
    return currentIndex - 1;
  }

  if (fromIndex > toIndex && currentIndex >= toIndex && currentIndex < fromIndex) {
    return currentIndex + 1;
  }

  return currentIndex;
}

function InlineMarkdownBlockTextarea({
  id,
  value,
  invalid,
  compact,
  onBlur,
  onChange,
  onKeyDown,
}: {
  id: string;
  value: string;
  invalid: boolean;
  compact: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <Textarea
      ref={textareaRef}
      id={id}
      data-testid="markdown-block-textarea"
      autoFocus
      value={value}
      aria-invalid={invalid}
      rows={1}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={cn(
        "min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent pr-3 pl-0 !text-base !leading-7 shadow-none focus-visible:ring-0",
        compact ? "py-0" : "py-2",
      )}
    />
  );
}

function MarkdownBlockPreview({ block }: { block: MarkdownBlock }) {
  const trimmed = block.source.trim();

  if (block.kind === "empty") {
    return <span className="text-muted-foreground text-base leading-7">Empty block</span>;
  }

  if (block.kind === "code") {
    const code = trimmed.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    return (
      <pre className="bg-muted overflow-auto rounded-md p-3 text-base leading-7">
        <code>{code}</code>
      </pre>
    );
  }

  if (block.kind === "heading") {
    const text = trimmed.replace(/^#{1,6}\s+/, "");
    const level = block.headingLevel;
    if (level === 1) {
      return <h1 className="text-2xl font-semibold leading-tight">{renderInlineMarkdown(text)}</h1>;
    }
    if (level === 2) {
      return <h2 className="text-xl font-semibold leading-tight">{renderInlineMarkdown(text)}</h2>;
    }
    if (level === 3) {
      return <h3 className="text-lg font-semibold leading-tight">{renderInlineMarkdown(text)}</h3>;
    }
    return <h4 className="text-base font-semibold leading-tight">{renderInlineMarkdown(text)}</h4>;
  }

  if (block.kind === "quote") {
    return (
      <blockquote className="text-muted-foreground border-l-2 pl-3 text-base leading-7">
        {renderMarkdownLines(trimmed.split("\n").map((line) => line.replace(/^\s{0,3}>\s?/, "")))}
      </blockquote>
    );
  }

  if (block.kind === "unordered-list" || block.kind === "ordered-list") {
    const items = block.source.trimEnd().split("\n").map((line) => line.replace(/^[ \t]*(?:[-*+]\s*|\d+\.\s*)/, ""));

    if (block.kind === "ordered-list") {
      return (
        <ol className="list-inside text-base leading-7" start={block.listStart} style={{ listStyleType: orderedListStyleForLevel(block.listLevel) }}>
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
    }

    return (
      <ul className="list-none text-base leading-7">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-start gap-2.5">
            <span aria-hidden="true" className="flex h-7 w-1.5 shrink-0 items-center">
              <span
                data-testid="markdown-list-marker"
                className={cn("size-1.5", unorderedListMarkerClass(block.listLevel))}
              />
            </span>
            <span className="min-w-0 flex-1">{renderInlineMarkdown(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  return <p className="text-base leading-7">{renderMarkdownLines(trimmed.split("\n"))}</p>;
}

function orderedListStyleForLevel(level: number) {
  return level % 2 === 0 ? "decimal" : "lower-alpha";
}

function unorderedListMarkerClass(level: number) {
  if (level === 0) {
    return "rounded-full bg-current";
  }

  if (level % 2 === 0) {
    return "bg-current";
  }

  return "rounded-full border border-current";
}

function renderMarkdownLines(lines: string[]) {
  return lines.map((line, index) => (
    <React.Fragment key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {renderInlineMarkdown(line)}
    </React.Fragment>
  ));
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(!?\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    nodes.push(renderInlineToken(token, nodes.length));
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : text;
}

function renderInlineToken(token: string, key: number) {
  const image = token.match(/^!\[([^\]]+)\]\(([^)]+)\)$/);
  if (image) {
    return <span key={key} className="text-muted-foreground italic">{image[1]}</span>;
  }

  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    const href = safeMarkdownHref(link[2] ?? "");
    if (!href) {
      return <span key={key}>{link[1]}</span>;
    }
    return (
      <a key={key} href={href} className="underline underline-offset-2" onClick={(event) => event.preventDefault()}>
        {link[1]}
      </a>
    );
  }

  if (token.startsWith("`")) {
    return <code key={key} className="bg-muted rounded px-1 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>;
  }

  if (token.startsWith("**")) {
    return <strong key={key}>{token.slice(2, -2)}</strong>;
  }

  return <em key={key}>{token.slice(1, -1)}</em>;
}

function safeMarkdownHref(href: string) {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|at:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function RightPanel({
  draft,
  selectedPublication,
  calendarItems,
  scheduledDate,
  onScheduledDate,
  onSchedule,
  onDraftChange,
}: {
  draft?: Draft;
  selectedPublication?: Publication;
  calendarItems: ReturnType<typeof calendarItemsFromDrafts>;
  scheduledDate?: Date;
  onScheduledDate: (date?: Date) => void;
  onSchedule: () => void;
  onDraftChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <aside className="hidden min-h-0 border-l xl:flex xl:flex-col">
      <Tabs defaultValue="metadata" className="min-h-0 flex-1">
        <div className="flex h-14 shrink-0 items-center border-b px-3">
          <TabsList className={sideTabsListClassName}>
            <TabsTrigger value="metadata" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Meta</span>
            </TabsTrigger>
            <TabsTrigger value="schedule" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Schedule</span>
            </TabsTrigger>
            <TabsTrigger value="calendar" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Calendar</span>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="metadata" className="min-h-0 flex-1 overflow-auto p-4">
          {draft ? (
            <FieldGroup>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    Publication
                    {selectedPublication?.host ? (
                      <Badge variant="secondary">{selectedPublication.host}</Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>{selectedPublication?.themeType ?? selectedPublication?.url}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <span className="truncate">{selectedPublication?.name ?? "No publication selected"}</span>
                  <span className="text-muted-foreground truncate text-xs">{selectedPublication?.url}</span>
                </CardContent>
              </Card>
              <Field>
                <FieldLabel htmlFor="path">Path</FieldLabel>
                <Input
                  id="path"
                  value={draft.path ?? ""}
                  onChange={(event) => onDraftChange({ path: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="excerpt">Excerpt</FieldLabel>
                <Textarea
                  id="excerpt"
                  value={draft.excerpt ?? ""}
                  onChange={(event) => onDraftChange({ excerpt: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tags">Tags</FieldLabel>
                <Input
                  id="tags"
                  value={draft.tags.join(", ")}
                  onChange={(event) =>
                    onDraftChange({
                      tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                    })
                  }
                />
              </Field>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon />
                    Cover
                  </CardTitle>
                  <CardDescription>Device upload and Unsplash covers publish as `coverImage` blobs.</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button variant="outline" size="sm">Upload</Button>
                  <Button variant="outline" size="sm">Unsplash</Button>
                </CardContent>
              </Card>
            </FieldGroup>
          ) : null}
        </TabsContent>
        <TabsContent value="schedule" className="p-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClockIcon />
                Publish date
              </CardTitle>
              <CardDescription>Scheduling creates or updates a community calendar event.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start">
                    <CalendarDaysIcon data-icon="inline-start" />
                    {scheduledDate ? format(scheduledDate, "PPP") : "Choose date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar mode="single" selected={scheduledDate} onSelect={onScheduledDate} />
                </PopoverContent>
              </Popover>
              <Button onClick={onSchedule} disabled={!draft || !scheduledDate}>
                <CalendarDaysIcon data-icon="inline-start" />
                Schedule
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="calendar" className="min-h-0 overflow-auto p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Article</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calendarItems.map((item) => (
                <TableRow key={item.draftID}>
                  <TableCell className="max-w-40 truncate">{item.title}</TableCell>
                  <TableCell>{item.date ? format(parseISO(item.date), "MMM d") : "No date"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
