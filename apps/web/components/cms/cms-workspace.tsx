"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import * as draftAPI from "@/lib/draft-api";
import { APIError } from "@/lib/api";
import { EditorPanel } from "@/components/cms/editor-panel";
import { OAuthConnectScreen } from "@/components/oauth-connect-screen";
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
  sortDraftsReverseChronological,
} from "@/lib/cms-data";
import { loadAccounts } from "@/lib/oauth-api";
import type { Draft, LinkedAccount, Publication } from "@/lib/types";
import { markdownToPlaintext, validateDraft } from "@/lib/validation";

export function CmsWorkspace() {
  const [accounts, setAccounts] = React.useState<LinkedAccount[]>([]);
  const [accountLoadState, setAccountLoadState] = React.useState<"loading" | "ready" | "error">("loading");
  const [publications, setPublications] = React.useState<Publication[]>([]);
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const activeAccount = accounts[0];
  const activeAccountDID = activeAccount?.did ?? "";
  const [selectedDraftID, setSelectedDraftID] = React.useState("");
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [publicationDraft, setPublicationDraft] = React.useState<Draft | null>(null);
  const [scheduleDraftToEdit, setScheduleDraftToEdit] = React.useState<Draft | null>(null);
  const [scheduleDateTime, setScheduleDateTime] = React.useState("");
  const [deleteDraftToConfirm, setDeleteDraftToConfirm] = React.useState<Draft | null>(null);
  const [revertDraftToConfirm, setRevertDraftToConfirm] = React.useState<Draft | null>(null);
  const [isMutatingDraft, setIsMutatingDraft] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [draftListTab, setDraftListTab] = React.useState<DraftListTab>("drafts");
  const [draftListGrouping, setDraftListGrouping] = React.useState<DraftListGrouping>("all");
  const [scheduledDate, setScheduledDate] = React.useState<Date | undefined>();
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

  const requestAccounts = React.useCallback((signal: AbortSignal) => {
    loadAccounts(signal)
      .then((linkedAccounts) => {
        setAccounts(linkedAccounts);
        setAccountLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAccountLoadState("error");
      });
  }, []);

  const refreshAccounts = React.useCallback(() => {
    const controller = new AbortController();
    setAccountLoadState("loading");
    requestAccounts(controller.signal);
    return () => controller.abort();
  }, [requestAccounts]);

  React.useEffect(() => {
    const controller = new AbortController();
    requestAccounts(controller.signal);
    return () => controller.abort();
  }, [requestAccounts]);

  React.useEffect(() => {
    if (!activeAccountDID) return;
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

  React.useEffect(() => {
    if (!activeAccountDID) return;
    const controller = new AbortController();

    draftAPI.loadPublications(activeAccountDID, controller.signal)
      .then(async (persistedPublications) => {
        if (persistedPublications.length > 0) {
          setPublications(persistedPublications);
          return;
        }
        const syncedPublications = await draftAPI.syncPublications(activeAccountDID);
        if (!controller.signal.aborted) setPublications(syncedPublications);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.error("Could not load saved publications");
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

  async function scheduleDraft() {
    if (!activeDraft || !scheduledDate || isMutatingDraft) {
      return;
    }
    setIsMutatingDraft(true);
    try {
      await draftAPI.saveDraft(activeDraft);
      const persisted = await draftAPI.scheduleDraft(activeDraft.id, scheduledDate);
      replaceDraft(persisted);
      setDraftListTab("scheduled");
      setSelectedDraftID(persisted.id);
      toast.success("Draft scheduled");
    } catch (error) {
      toast.error(errorMessage(error, "Could not schedule draft"));
    } finally {
      setIsMutatingDraft(false);
    }
  }

  async function publishDraft() {
    if (!activeDraft || !validation.valid || isPublishing) {
      toast.error("Resolve validation before publishing");
      return;
    }
    setIsPublishing(true);
    try {
      await draftAPI.saveDraft(activeDraft);
      await draftAPI.publishDraft(activeDraft.id);
      const persisted = await draftAPI.getDraft(activeDraft.id);
      replaceDraft(persisted);
      setDraftListTab("published");
      setSelectedDraftID(persisted.id);
      toast.success("Article published");
    } catch (error) {
      const persisted = await draftAPI.getDraft(activeDraft.id).catch(() => null);
      if (persisted) {
        replaceDraft(persisted);
        if (persisted.status === "failed") setDraftListTab("drafts");
      }
      toast.error(errorMessage(error, "Could not publish article"));
    } finally {
      setIsPublishing(false);
    }
  }

  async function syncPublications() {
    setIsSyncing(true);
    try {
      const synced = await draftAPI.syncPublications(activeAccountDID);
      setPublications(synced);
      toast.success("Publication cache refreshed");
    } catch (error) {
      toast.error(errorMessage(error, "Could not sync publications"));
    } finally {
      setIsSyncing(false);
    }
  }

  const shellStyle = {
    "--workbench-columns": `${columnLayout.draftList}px 9px minmax(0,1fr) 9px ${columnLayout.metadataPanel}px`,
  } as React.CSSProperties & {
    "--workbench-columns": string;
  };

  if (accountLoadState === "loading") {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        Loading account…
      </main>
    );
  }

  if (!activeAccount) {
    return (
      <OAuthConnectScreen
        accountLoadFailed={accountLoadState === "error"}
        onRetry={refreshAccounts}
      />
    );
  }

  return (
    <TooltipProvider>
      <div className="app-appearance-scope flex h-[calc(100dvh-var(--environment-banner-height,0px))] min-h-0 bg-background text-foreground" style={shellStyle}>
        <main className="flex min-w-0 flex-1 flex-col">
          <WorkspaceHeader
            theme={themePreference}
            publications={accountPublications}
            isSyncing={isSyncing}
            canPublish={Boolean(activeDraft && validation.valid && !isPublishing)}
            isPublishing={isPublishing}
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof APIError ? error.message : fallback;
}
