"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import * as draftAPI from "@/lib/draft-api";
import { EditorPanel } from "@/components/cms/editor-panel";
import {
  DraftList,
  type DraftListGrouping,
  type DraftListTab,
} from "@/components/cms/draft-list";
import {
  ChangePublicationDialog,
  ConfirmPostActionDialog,
  EditScheduleDialog,
} from "@/components/cms/post-dialogs";
import { RightPanel } from "@/components/cms/right-panel";
import { WorkspaceHeader } from "@/components/cms/workspace-header";
import { ColumnResizeHandle, useWorkspaceLayout } from "@/components/cms/workspace-layout";
import { useAppearancePreferences } from "@/components/cms/use-appearance-preferences";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  calendarItemsFromDrafts,
  seedAccounts,
  seedDrafts,
  seedPublications,
  sortDraftsReverseChronological,
} from "@/lib/cms-data";
import type { Draft, Publication } from "@/lib/types";
import { markdownToPlaintext, validateDraft } from "@/lib/validation";

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

export function CmsWorkspace() {
  const [publications] = React.useState(seedPublications);
  const [drafts, setDrafts] = React.useState(seedDrafts);
  const activeAccount = activeSeedAccount;
  const activeAccountDID = activeAccount?.did ?? "";
  const [selectedDraftID, setSelectedDraftID] = React.useState(initialDraftID);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [publicationDraft, setPublicationDraft] = React.useState<Draft | null>(null);
  const [scheduleDraftToEdit, setScheduleDraftToEdit] = React.useState<Draft | null>(null);
  const [scheduleDateTime, setScheduleDateTime] = React.useState("");
  const [deleteDraftToConfirm, setDeleteDraftToConfirm] = React.useState<Draft | null>(null);
  const [revertDraftToConfirm, setRevertDraftToConfirm] = React.useState<Draft | null>(null);
  const [isMutatingDraft, setIsMutatingDraft] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [draftListTab, setDraftListTab] = React.useState<DraftListTab>(initialDraftListTab);
  const [draftListGrouping, setDraftListGrouping] = React.useState<DraftListGrouping>("all");
  const [scheduledDate, setScheduledDate] = React.useState<Date | undefined>(() => {
    const draft = seedDrafts[0];
    return draft?.scheduledAt ? parseISO(draft.scheduledAt) : undefined;
  });
  const {
    themePreference,
    fontPreference,
    boldText,
    smallText,
    changeThemePreference,
    changeFontPreference,
    changeBoldText,
    changeSmallText,
  } = useAppearancePreferences();
  const { columnLayout, bounds: columnLayoutBounds, resizeColumn, beginColumnResize } = useWorkspaceLayout();

  React.useEffect(() => {
    const controller = new AbortController();

    draftAPI.loadDrafts(activeAccountDID, controller.signal)
      .then((persistedDrafts) => {
        setDrafts(persistedDrafts);
        setSelectedDraftID((current) =>
          persistedDrafts.some((draft) => draft.id === current)
            ? current
            : persistedDrafts[0]?.id ?? "",
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        toast.error("Could not load saved drafts");
      });

    return () => controller.abort();
  }, [activeAccountDID]);

  const accountPublications = React.useMemo(
    () => publications.filter((publication) => publication.accountDID === activeAccountDID),
    [activeAccountDID, publications],
  );

  const visibleDrafts = React.useMemo(() => {
    return sortDraftsReverseChronological(drafts.filter((draft) => {
      const matchesAccount = draft.accountDID === activeAccountDID;
      const matchesTab =
        (draftListTab === "drafts" && (draft.status === "draft" || draft.status === "failed" || draft.status === "publishing")) ||
        (draftListTab === "scheduled" && draft.status === "scheduled") ||
        (draftListTab === "published" && draft.status === "published");
      const matchesSearch =
        !search ||
        draft.title.toLowerCase().includes(search.toLowerCase()) ||
        draft.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      return matchesAccount && matchesTab && matchesSearch;
    }));
  }, [activeAccountDID, draftListTab, drafts, search]);

  const activeDraft = React.useMemo(() => {
    return visibleDrafts.find((draft) => draft.id === selectedDraftID) ?? visibleDrafts[0];
  }, [selectedDraftID, visibleDrafts]);

  const selectedPublication = React.useMemo(
    () => publications.find((publication) => publication.uri === activeDraft?.publicationURI) ?? accountPublications[0],
    [accountPublications, activeDraft?.publicationURI, publications],
  );

  const validation = React.useMemo(() => {
    if (!activeDraft) {
      return { valid: false, errors: {} };
    }
    return validateDraft(activeDraft);
  }, [activeDraft]);

  const calendarItems = React.useMemo(() => calendarItemsFromDrafts(drafts), [drafts]);

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

  async function createDraft(publicationURI: string) {
    const publication = accountPublications.find((candidate) => candidate.uri === publicationURI);
    if (!publication) {
      return false;
    }
    const next: Draft = {
      id: crypto.randomUUID(),
      accountDID: activeAccountDID,
      publicationURI: publication.uri,
      publicationURL: publication.url,
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
    try {
      const persisted = await draftAPI.createDraft(next);
      setDrafts((current) => [persisted, ...current]);
      setSearch("");
      setDraftListTab("drafts");
      setSelectedDraftID(persisted.id);
      return true;
    } catch {
      toast.error("Could not create draft");
      return false;
    }
  }

  async function saveDraft() {
    if (!activeDraft || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      const persisted = await draftAPI.saveDraft(activeDraft);
      setDrafts((current) => current.map((draft) => draft.id === persisted.id ? persisted : draft));
      toast.success("Draft saved");
    } catch {
      toast.error("Could not save draft");
    } finally {
      setIsSaving(false);
    }
  }

  function replaceDraft(persisted: Draft) {
    setDrafts((current) => current.map((draft) => draft.id === persisted.id ? persisted : draft));
  }

  function beginScheduleEdit(draft: Draft) {
    setScheduleDraftToEdit(draft);
    setScheduleDateTime(
      draft.scheduledAt ? format(parseISO(draft.scheduledAt), "yyyy-MM-dd'T'HH:mm") : "",
    );
  }

  async function changeDraftPublication(draft: Draft, publication: Publication) {
    setIsMutatingDraft(true);
    try {
      const persisted = await draftAPI.changeDraftPublication(draft.id, publication);
      replaceDraft(persisted);
      setPublicationDraft(null);
      toast.success("Publication changed");
    } catch {
      toast.error("Could not change publication");
    } finally {
      setIsMutatingDraft(false);
    }
  }

  async function updateScheduledTime() {
    if (!scheduleDraftToEdit || !scheduleDateTime) {
      return;
    }
    setIsMutatingDraft(true);
    try {
      const persisted = await draftAPI.scheduleDraft(scheduleDraftToEdit.id, new Date(scheduleDateTime));
      replaceDraft(persisted);
      setScheduleDraftToEdit(null);
      toast.success("Scheduled time updated");
    } catch {
      toast.error("Could not update scheduled time");
    } finally {
      setIsMutatingDraft(false);
    }
  }

  async function revertDraftToDraft() {
    if (!revertDraftToConfirm) {
      return;
    }
    setIsMutatingDraft(true);
    try {
      const persisted = await draftAPI.revertDraft(revertDraftToConfirm.id);
      replaceDraft(persisted);
      setRevertDraftToConfirm(null);
      setDraftListTab("drafts");
      setSelectedDraftID(persisted.id);
      toast.success("Post reverted to draft");
    } catch {
      toast.error("Could not revert post");
    } finally {
      setIsMutatingDraft(false);
    }
  }

  async function deleteDraft() {
    if (!deleteDraftToConfirm) {
      return;
    }
    setIsMutatingDraft(true);
    try {
      await draftAPI.deleteDraft(deleteDraftToConfirm.id);
      setDrafts((current) => current.filter((draft) => draft.id !== deleteDraftToConfirm.id));
      setDeleteDraftToConfirm(null);
      toast.success("Post deleted");
    } catch {
      toast.error("Could not delete post");
    } finally {
      setIsMutatingDraft(false);
    }
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

  const shellStyle = {
    "--workbench-columns": `${columnLayout.draftList}px 9px minmax(0,1fr) 9px ${columnLayout.metadataPanel}px`,
  } as React.CSSProperties & {
    "--workbench-columns": string;
  };

  return (
    <TooltipProvider>
      <div className="app-appearance-scope flex h-dvh min-h-0 bg-background text-foreground" style={shellStyle}>
        <main className="flex min-w-0 flex-1 flex-col">
          <WorkspaceHeader
            theme={themePreference}
            publications={accountPublications}
            isSyncing={isSyncing}
            canPublish={Boolean(activeDraft && validation.valid)}
            onThemeChange={changeThemePreference}
            onSync={syncPublications}
            onCreateDraft={createDraft}
            onPublish={publishDraft}
          />

          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[var(--workbench-columns)]">
            <DraftList
              drafts={visibleDrafts}
              publications={accountPublications}
              activeTab={draftListTab}
              grouping={draftListGrouping}
              account={activeAccount}
              boldText={boldText}
              smallText={smallText}
              fontPreference={fontPreference}
              selectedDraftID={activeDraft?.id}
              search={search}
              onTabChange={setDraftListTab}
              onGroupingChange={setDraftListGrouping}
              onBoldTextChange={changeBoldText}
              onSmallTextChange={changeSmallText}
              onFontPreferenceChange={changeFontPreference}
              onSearch={setSearch}
              onSelectDraft={setSelectedDraftID}
              onChangePublication={setPublicationDraft}
              onEditSchedule={beginScheduleEdit}
              onDelete={setDeleteDraftToConfirm}
              onRevert={setRevertDraftToConfirm}
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
                onSave={saveDraft}
                isSaving={isSaving}
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
        <ChangePublicationDialog
          draft={publicationDraft}
          publications={accountPublications}
          busy={isMutatingDraft}
          onOpenChange={(open) => !open && setPublicationDraft(null)}
          onChange={changeDraftPublication}
        />
        <EditScheduleDialog
          draft={scheduleDraftToEdit}
          value={scheduleDateTime}
          busy={isMutatingDraft}
          onValueChange={setScheduleDateTime}
          onOpenChange={(open) => !open && setScheduleDraftToEdit(null)}
          onSave={updateScheduledTime}
        />
        <ConfirmPostActionDialog
          draft={revertDraftToConfirm}
          action="revert"
          busy={isMutatingDraft}
          onOpenChange={(open) => !open && setRevertDraftToConfirm(null)}
          onConfirm={revertDraftToDraft}
        />
        <ConfirmPostActionDialog
          draft={deleteDraftToConfirm}
          action="delete"
          busy={isMutatingDraft}
          onOpenChange={(open) => !open && setDeleteDraftToConfirm(null)}
          onConfirm={deleteDraft}
        />
      </div>
    </TooltipProvider>
  );
}
