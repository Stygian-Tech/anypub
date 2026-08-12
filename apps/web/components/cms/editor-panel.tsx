"use client";

import * as React from "react";
import { BlockEditor, importMarkdownDocument, parseBlockDocument, type BlockDocument, type BlockEditorHandle } from "@anypub/block-editor";
import { ImagePlusIcon, LinkIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { assetContentURL, uploadImage } from "@/lib/asset-api";
import type { DraftSaveState } from "@/lib/draft-editor";
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
  saveState,
}: {
  draft: Draft;
  validation: Record<string, string>;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => Promise<void>;
  saveState: DraftSaveState;
}) {
  const editorRef = React.useRef<BlockEditorHandle>(null);
  const bodyImageInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = React.useState(false);
  const [showLinkComposer, setShowLinkComposer] = React.useState(false);
  const [linkURL, setLinkURL] = React.useState("");
  const isSaving = saveState === "saving";
  const saveStateLabel = {
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    error: "Autosave failed",
  }[saveState];

  async function uploadBodyImage(file?: File) {
    if (!file) return;
    setUploadingImage(true);
    try {
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      const asset = await uploadImage(draft.accountDID, file, alt);
      editorRef.current?.insertBlock(`![${alt}](anypub-asset://${asset.id})`);
      toast.success("Image added to article");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload image");
    } finally {
      setUploadingImage(false);
      if (bodyImageInputRef.current) bodyImageInputRef.current.value = "";
    }
  }

  function insertLink(mode: "link" | "embed") {
    const url = linkURL.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      toast.error("Enter a complete http or https URL");
      return;
    }
    editorRef.current?.insertBlock(mode === "embed" ? `@[embed](${url})` : `[${url}](${url})`);
    setLinkURL("");
    setShowLinkComposer(false);
  }

  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant[draft.status]}>{draft.status}</Badge>
          <span className="text-muted-foreground text-xs">{draft.path}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={bodyImageInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            aria-label="Choose an image for the article body"
            onChange={(event) => void uploadBodyImage(event.target.files?.[0])}
          />
          <Button variant="outline" size="sm" disabled={uploadingImage} onClick={() => bodyImageInputRef.current?.click()}>
            <ImagePlusIcon data-icon="inline-start" />
            {uploadingImage ? "Uploading…" : "Image"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowLinkComposer((visible) => !visible)}>
            <LinkIcon data-icon="inline-start" />
            Link
          </Button>
          <span
            className={saveState === "error" ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
            role="status"
            aria-live="polite"
          >
            {saveStateLabel}
          </span>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            <SaveIcon data-icon="inline-start" />
            {isSaving ? "Saving" : draft.status === "published" ? "Save changes" : "Save"}
          </Button>
        </div>
      </div>
      {showLinkComposer ? (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-3">
          <Input
            autoFocus
            aria-label="Link URL"
            placeholder="https://example.com"
            value={linkURL}
            onChange={(event) => setLinkURL(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && insertLink("link")}
          />
          <Button size="sm" onClick={() => insertLink("link")}>Add link</Button>
          <Button size="sm" variant="secondary" onClick={() => insertLink("embed")}>Embed</Button>
        </div>
      ) : null}
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
            ref={editorRef}
            key={draft.id}
            document={blockDocumentForDraft(draft)}
            invalid={Boolean(validation.markdown)}
            resolveAssetURL={assetContentURL}
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
