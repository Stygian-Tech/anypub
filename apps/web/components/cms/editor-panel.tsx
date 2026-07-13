"use client";

import { BlockEditor, importMarkdownDocument, parseBlockDocument, type BlockDocument } from "@anypub/block-editor";
import { SaveIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Draft, DraftStatus } from "@/lib/types";

const statusVariant: Record<DraftStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  publishing: "secondary",
  published: "default",
  failed: "destructive",
};

function blockDocumentForDraft(draft: Draft): BlockDocument {
  if (draft.blockDocumentJSON) {
    try {
      return parseBlockDocument(JSON.parse(draft.blockDocumentJSON));
    } catch {
      // Legacy or divergent snapshots are rebuilt from the canonical Markdown.
    }
  }
  return importMarkdownDocument(draft.markdown, { revision: draft.blockRevision ?? 0 });
}

export function EditorPanel({
  draft,
  validation,
  onChange,
  onSave,
  isSaving,
}: {
  draft: Draft;
  validation: Record<string, string>;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant[draft.status]}>{draft.status}</Badge>
          <span className="text-muted-foreground text-xs">{draft.path}</span>
        </div>
        <Button size="sm" onClick={onSave} disabled={isSaving}>
          <SaveIcon data-icon="inline-start" />
          {isSaving ? "Saving" : "Save"}
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
          <BlockEditor
            key={draft.id}
            document={blockDocumentForDraft(draft)}
            invalid={Boolean(validation.markdown)}
            onChange={(document) => onChange({
              markdown: document.markdown,
              blockDocumentJSON: JSON.stringify(document),
              blockSchemaVersion: document.schemaVersion,
              blockRevision: document.revision,
            })}
          />
        </div>
      </div>
    </section>
  );
}
