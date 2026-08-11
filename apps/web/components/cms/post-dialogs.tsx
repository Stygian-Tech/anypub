"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PublicationIcon } from "@/components/cms/publication-icon";
import type { Draft, Publication } from "@/lib/types";

export function NewDraftDialog({
  publications,
  onCreate,
}: {
  publications: Publication[];
  onCreate: (publicationURI: string) => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState(false);

  async function createForPublication(publicationURI: string) {
    if (await onCreate(publicationURI)) {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={publications.length === 0}
          title={publications.length === 0 ? "No publications found" : undefined}
        >
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a publication</DialogTitle>
          <DialogDescription>The new draft will be created for this publication.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {publications.map((publication) => (
            <button
              key={publication.uri}
              type="button"
              onClick={() => createForPublication(publication.uri)}
              className="border-border hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2"
            >
              <PublicationIcon publication={publication} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{publication.name}</span>
                </span>
                <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="shrink-0">{publication.host ?? "standard.site"}</span>
                  <span aria-hidden>/</span>
                  <span className="truncate">{publication.url}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ChangePublicationDialog({
  draft,
  publications,
  busy,
  onOpenChange,
  onChange,
}: {
  draft: Draft | null;
  publications: Publication[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (draft: Draft, publication: Publication) => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change publication</DialogTitle>
          <DialogDescription>Move this draft to another publication.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {publications.map((publication) => (
            <button
              key={publication.uri}
              type="button"
              disabled={busy || publication.uri === draft?.publicationURI}
              onClick={() => draft && onChange(draft, publication)}
              className="border-border hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 disabled:opacity-50"
            >
              <PublicationIcon publication={publication} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{publication.name}</span>
                <span className="text-muted-foreground block truncate text-xs">{publication.url}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditScheduleDialog({
  draft,
  value,
  busy,
  onValueChange,
  onOpenChange,
  onSave,
}: {
  draft: Draft | null;
  value: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit scheduled time</DialogTitle>
          <DialogDescription>{draft?.title}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="context-scheduled-at">Publication date and time</FieldLabel>
          <Input
            id="context-scheduled-at"
            type="datetime-local"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={busy || !value}>{busy ? "Saving" : "Save time"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmPostActionDialog({
  draft,
  action,
  busy,
  onOpenChange,
  onConfirm,
}: {
  draft: Draft | null;
  action: "delete" | "revert";
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const published = draft?.status === "published";
  const deleting = action === "delete";

  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{deleting ? "Delete post?" : "Revert to draft?"}</DialogTitle>
          <DialogDescription>
            {published
              ? "This will delete the remote standard.site record and clear its publication linkage."
              : deleting
                ? "This removes the post from local draft storage."
                : "This clears the scheduled time and returns the post to Drafts."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={deleting ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working" : deleting ? "Delete" : "Revert"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
