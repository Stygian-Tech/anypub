import type { Draft } from "@/lib/types";

export const DRAFT_AUTOSAVE_DELAY_MS = 800;

export type DraftSaveState = "saved" | "unsaved" | "saving" | "error";

export function slugDiscriminatorFromDraftID(draftID: string) {
  return draftID.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-7).padStart(7, "0");
}

export function slugPathDiscriminator(path: string | undefined, title: string) {
  const match = path?.match(/^(.*)-([a-z0-9]{7})$/);
  return match?.[1] === slugPathFromTitle(title, "").replace(/-$/, "") ? match[2] : undefined;
}

export function slugPathFromTitle(title: string, discriminator: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return `/${slug || "untitled-article"}-${discriminator}`;
}

export function titleManagedPath(draft: Pick<Draft, "status" | "title" | "path">) {
  if (draft.status !== "draft" && draft.status !== "failed") {
    return false;
  }
  if (!draft.path) return true;
  const discriminator = slugPathDiscriminator(draft.path, draft.title);
  const generatedPath = discriminator
    ? slugPathFromTitle(draft.title, discriminator)
    : slugPathFromTitle(draft.title, "").replace(/-$/, "");
  return draft.path === generatedPath;
}
