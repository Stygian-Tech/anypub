"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { researchMarkdown, type ResearchPostMaterial, type ResearchPostParts } from "@/lib/research-composer";
import type { Draft, Publication } from "@/lib/types";

export type ResearchPostSubmission = {
  title: string;
  markdown: string;
  destination: { type: "existing"; draftID: string } | { type: "new"; publicationURI: string };
};

export function ResearchPostDialog({ material, drafts, publications, onOpenChange, onSubmit }: {
  material: ResearchPostMaterial;
  drafts: Draft[];
  publications: Publication[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (submission: ResearchPostSubmission) => Promise<boolean>;
}) {
  const [destination, setDestination] = React.useState<"existing" | "new">(drafts.length ? "existing" : "new");
  const [draftID, setDraftID] = React.useState(drafts[0]?.id ?? "");
  const [publicationURI, setPublicationURI] = React.useState(publications[0]?.uri ?? "");
  const [parts, setParts] = React.useState<ResearchPostParts>({
    quote: Boolean(material.quote), link: Boolean(material.sourceURL), comment: Boolean(material.comment),
  });
  const [busy, setBusy] = React.useState(false);
  const submitting = React.useRef(false);
  const [error, setError] = React.useState("");
  const markdown = researchMarkdown(material, parts);
  const selectedDraftID = drafts.some((draft) => draft.id === draftID) ? draftID : drafts[0]?.id ?? "";
  const selectedPublicationURI = publications.some((publication) => publication.uri === publicationURI)
    ? publicationURI : publications[0]?.uri ?? "";
  const hasDestination = destination === "existing"
    ? Boolean(selectedDraftID)
    : Boolean(selectedPublicationURI);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !hasDestination || !markdown) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await onSubmit({
        title: material.title,
        markdown,
        destination: destination === "existing" ? { type: "existing", draftID: selectedDraftID } : { type: "new", publicationURI: selectedPublicationURI },
      });
      if (saved) onOpenChange(false);
      else setError("Could not save this research to your draft. Please try again.");
    } catch {
      setError("Could not save this research to your draft. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!submitting.current) onOpenChange(open); }}>
      <DialogContent mobileSheet className="sm:max-w-xl">
        <DialogHeader className="min-w-0 pr-8 text-left">
          <DialogTitle>Use in post</DialogTitle>
          <DialogDescription className="break-words">Choose what to include from “{material.title}”, then continue writing.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid min-w-0 gap-5">
          <fieldset disabled={busy} className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className="mb-2 text-sm font-medium">Include</legend>
            {([
              ["quote", "Quote", material.quote],
              ["link", "Source link", material.sourceURL],
              ["comment", "Comment", material.comment],
            ] as const).map(([part, label, available]) => available ? (
              <label key={part} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={parts[part]} onChange={(event) => setParts((current) => ({ ...current, [part]: event.target.checked }))} className="size-4 accent-primary" />
                {label}
              </label>
            ) : null)}
          </fieldset>
          <section aria-label="Post preview" className="bg-muted/30 max-h-56 space-y-3 overflow-y-auto rounded-md border p-4 text-sm leading-6 [overflow-wrap:anywhere]">
            {parts.quote && material.quote ? <blockquote className="whitespace-pre-wrap border-l-2 border-primary/40 pl-3">{material.quote}</blockquote> : null}
            {parts.link && material.sourceURL ? (
              <p><a href={material.sourceURL} target="_blank" rel="noreferrer" className="underline underline-offset-4">{material.title}</a>{material.author ? ` — ${material.author}` : ""}</p>
            ) : null}
            {parts.comment && material.comment ? <p className="whitespace-pre-wrap">{material.comment}</p> : null}
            {!markdown ? <p className="text-muted-foreground">Select something to include in your post.</p> : null}
          </section>
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <legend className="mb-2 text-sm font-medium">Add to</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex min-h-9 items-center gap-2">
                <input type="radio" name="research-destination" checked={destination === "existing"} onChange={() => setDestination("existing")} className="size-4 accent-primary" /> Existing draft
              </label>
              <label className="flex min-h-9 items-center gap-2">
                <input type="radio" name="research-destination" checked={destination === "new"} onChange={() => setDestination("new")} className="size-4 accent-primary" /> New draft
              </label>
            </div>
            {destination === "existing" ? drafts.length ? (
              <Field>
                <FieldLabel htmlFor="research-draft">Draft</FieldLabel>
                <select id="research-draft" value={selectedDraftID} onChange={(event) => setDraftID(event.target.value)} className="bg-background h-11 w-full min-w-0 rounded-md border px-3 text-sm">
                  {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title || "Untitled article"} · {publications.find((publication) => publication.uri === draft.publicationURI)?.name ?? draft.publicationURL}</option>)}
                </select>
                <p className="text-muted-foreground text-xs">Appends to the end of your draft. Your existing writing stays in place.</p>
              </Field>
            ) : <p className="text-muted-foreground text-sm">No editable drafts yet. Choose New draft to start a post.</p> : publications.length ? (
              <Field>
                <FieldLabel htmlFor="research-publication">Publication</FieldLabel>
                <select id="research-publication" value={selectedPublicationURI} onChange={(event) => setPublicationURI(event.target.value)} className="bg-background h-11 w-full min-w-0 rounded-md border px-3 text-sm">
                  {publications.map((publication) => <option key={publication.uri} value={publication.uri}>{publication.name}</option>)}
                </select>
                <p className="text-muted-foreground text-xs">Starts a draft with this source’s title and your selected material.</p>
              </Field>
            ) : <p className="text-muted-foreground text-sm">No publications found. Sync your publications before creating a draft.</p>}
          </fieldset>
          {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !hasDestination || !markdown}>{busy ? "Saving…" : destination === "existing" ? "Add to draft" : "Create draft"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
