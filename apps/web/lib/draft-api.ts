import { apiFetch } from "./api";
import type { Draft, Publication } from "./types";

export function loadDrafts(accountDID: string, signal?: AbortSignal) {
  return apiFetch<Draft[]>(`/api/drafts?accountDID=${encodeURIComponent(accountDID)}`, { signal });
}

export function loadPublications(accountDID: string, signal?: AbortSignal) {
  return apiFetch<Publication[]>(`/api/publications?accountDID=${encodeURIComponent(accountDID)}`, { signal });
}

export function getDraft(draftID: string) {
  return apiFetch<Draft>(`/api/drafts/${draftID}`);
}

export function createDraft(draft: Draft) {
  return apiFetch<Draft>("/api/drafts", {
    method: "POST",
    body: JSON.stringify(draftUpsertPayload(draft)),
  });
}

export function saveDraft(draft: Draft) {
  return apiFetch<Draft>(`/api/drafts/${draft.id}`, {
    method: "PUT",
    body: JSON.stringify(draftUpsertPayload(draft)),
  });
}

export function changeDraftPublication(draftID: string, publication: Publication) {
  return apiFetch<Draft>(`/api/drafts/${draftID}/publication`, {
    method: "PATCH",
    body: JSON.stringify({ publicationURI: publication.uri, publicationURL: publication.url }),
  });
}

export function scheduleDraft(draftID: string, scheduledAt: Date) {
  return apiFetch<Draft>(`/api/drafts/${draftID}/schedule`, {
    method: "POST",
    body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
  });
}

export function publishDraft(draftID: string) {
  return apiFetch<{
    documentURI: string;
    documentCID: string;
    platformDocumentURI?: string;
    platformDocumentCID?: string;
    calendarEventURI?: string;
    calendarEventCID?: string;
  }>(`/api/drafts/${draftID}/publish`, { method: "POST" });
}

export function syncPublications(accountDID: string) {
  return apiFetch<Publication[]>("/api/publications/sync", {
    method: "POST",
    body: JSON.stringify({ accountDID }),
  });
}

export function revertDraft(draftID: string) {
  return apiFetch<Draft>(`/api/drafts/${draftID}/revert`, { method: "POST" });
}

export function deleteDraft(draftID: string) {
  return apiFetch<void>(`/api/drafts/${draftID}`, { method: "DELETE" });
}

function draftUpsertPayload(draft: Draft) {
  return {
    accountDID: draft.accountDID,
    publicationURI: draft.publicationURI,
    publicationURL: draft.publicationURL,
    title: draft.title,
    path: draft.path,
    excerpt: draft.excerpt,
    tags: draft.tags,
    markdown: draft.markdown,
    blockDocumentJSON: draft.blockDocumentJSON,
    blockSchemaVersion: draft.blockSchemaVersion ?? 1,
    blockRevision: draft.blockRevision ?? 0,
    coverAssetID: draft.coverAssetID,
  };
}
