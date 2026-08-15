"use client";

import * as React from "react";
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  ImagePlusIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { uploadImage } from "@/lib/asset-api";
import {
  hasFeedbackPermission,
  loadFeedbackBoard,
  submitFeedback,
  type FeedbackBoard,
  type FeedbackSubmission,
} from "@/lib/feedback-api";
import type { LinkedAccount } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 4;

type PendingImage = {
  id: string;
  file: File;
  previewURL: string;
};

export function FeedbackSection({
  account,
  onReconnect,
}: {
  account: LinkedAccount;
  onReconnect: () => void;
}) {
  const [board, setBoard] = React.useState<FeedbackBoard | null>(null);
  const [boardError, setBoardError] = React.useState("");
  const [isLoadingBoard, setIsLoadingBoard] = React.useState(true);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [images, setImages] = React.useState<PendingImage[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submission, setSubmission] = React.useState<FeedbackSubmission | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const previewURLs = React.useRef(new Set<string>());
  const canSubmit = hasFeedbackPermission(account.scope);

  const refreshBoard = React.useCallback((signal?: AbortSignal) => {
    setIsLoadingBoard(true);
    setBoardError("");
    loadFeedbackBoard(signal)
      .then(setBoard)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBoardError(error instanceof Error ? error.message : "Could not load the feedback board.");
      })
      .finally(() => setIsLoadingBoard(false));
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refreshBoard(controller.signal));
    return () => controller.abort();
  }, [refreshBoard]);

  React.useEffect(() => () => {
    previewURLs.current.forEach((url) => URL.revokeObjectURL(url));
    previewURLs.current.clear();
  }, []);

  const addImages = React.useCallback((files: File[]) => {
    const accepted = files.filter((file) => file.type.startsWith("image/"));
    if (accepted.length !== files.length) toast.error("Only image files can be attached.");
    setImages((current) => {
      const available = MAX_IMAGES - current.length;
      if (accepted.length > available) toast.error(`You can attach up to ${MAX_IMAGES} images.`);
      const additions = accepted.slice(0, available).map((file) => {
        const previewURL = URL.createObjectURL(file);
        previewURLs.current.add(previewURL);
        return {
          id: crypto.randomUUID(),
          file,
          previewURL,
        };
      });
      return [
        ...current,
        ...additions,
      ];
    });
  }, []);

  function removeImage(id: string) {
    setImages((current) => current.filter((image) => {
      if (image.id === id) {
        URL.revokeObjectURL(image.previewURL);
        previewURLs.current.delete(image.previewURL);
      }
      return image.id !== id;
    }));
  }

  function toggleTag(value: string) {
    setTags((current) => current.includes(value)
      ? current.filter((tag) => tag !== value)
      : [...current, value]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !board || !title.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const assets = await Promise.all(images.map(({ file }) => (
        uploadImage(account.did, file, file.name.replace(/\.[^.]+$/, ""))
      )));
      const result = await submitFeedback({
        title: title.trim(),
        body: body.trim() || undefined,
        tags,
        assetIDs: assets.map((asset) => asset.id),
      });
      images.forEach((image) => {
        URL.revokeObjectURL(image.previewURL);
        previewURLs.current.delete(image.previewURL);
      });
      setImages([]);
      setSubmission(result);
      toast.success("Feedback published");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish feedback.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submission) {
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6 sm:p-10">
        <Card className="w-full max-w-2xl border-blue-500/25">
          <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <CheckCircle2Icon className="size-6" aria-hidden />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">Thanks for helping shape AnyPub</h1>
              <p className="text-muted-foreground text-sm">Your feedback is published on the public User Input board.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <a href={submission.url} target="_blank" rel="noreferrer">
                  View feedback <ArrowUpRightIcon data-icon="inline-end" />
                </a>
              </Button>
              <Button variant="outline" onClick={() => {
                setTitle("");
                setBody("");
                setTags([]);
                setSubmission(null);
              }}>
                Send more feedback
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-5xl gap-6 p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <MessageSquareTextIcon className="size-5" aria-hidden />
              <span className="text-sm font-medium">Feedback</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Help shape AnyPub</h1>
            <p className="text-muted-foreground max-w-2xl text-sm leading-6">
              Report a bug, request a feature, or share an idea. Your submission is published from your AT Protocol account to AnyPub&apos;s public User Input board.
            </p>
          </div>

          {!canSubmit ? (
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader>
                <CardTitle className="text-base">Reconnect to send feedback</CardTitle>
                <CardDescription>
                  Your current session predates feedback permissions. Sign out and sign back in once to approve them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={onReconnect}>Log out to reconnect</Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Send feedback</CardTitle>
              <CardDescription>Include enough detail for us to understand and reproduce what you saw.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleSubmit}>
                <Field>
                  <FieldLabel htmlFor="feedback-title">Title</FieldLabel>
                  <Input
                    id="feedback-title"
                    maxLength={200}
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="What should we know?"
                    disabled={!canSubmit || isSubmitting}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="feedback-body">Details</FieldLabel>
                  <Textarea
                    id="feedback-body"
                    maxLength={10_000}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="What happened, what did you expect, and what would make this better?"
                    className="min-h-40 resize-y"
                    disabled={!canSubmit || isSubmitting}
                  />
                </Field>
                <Field>
                  <FieldLabel>Tags</FieldLabel>
                  {isLoadingBoard ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden /> Loading board tags…
                    </div>
                  ) : boardError ? (
                    <div className="flex items-center gap-3 text-sm text-destructive">
                      <span>{boardError}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => refreshBoard()}>
                        <RefreshCwIcon data-icon="inline-start" /> Retry
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2" aria-label="Feedback tags">
                      {board?.tags.map((tag) => {
                        const selected = tags.includes(tag.value);
                        return (
                          <button
                            key={tag.value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleTag(tag.value)}
                            disabled={!canSubmit || isSubmitting}
                            className={cn(
                              "min-h-11 rounded-full border px-4 py-2 text-sm transition-colors disabled:opacity-50 xl:min-h-0 xl:px-3 xl:py-1",
                              selected
                                ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                                : "border-border text-muted-foreground hover:border-blue-500/50 hover:text-foreground",
                            )}
                          >
                            {tag.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Field>
                <Field>
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel>Images</FieldLabel>
                    <span className="text-muted-foreground text-xs">{images.length}/{MAX_IMAGES}</span>
                  </div>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    aria-label="Attach feedback images"
                    onChange={(event) => {
                      addImages(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                    disabled={!canSubmit || isSubmitting || images.length >= MAX_IMAGES}
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDragging(false);
                      addImages(Array.from(event.dataTransfer.files));
                    }}
                    disabled={!canSubmit || isSubmitting || images.length >= MAX_IMAGES}
                    className={cn(
                      "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-7 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      isDragging ? "border-blue-500 bg-blue-500/5" : "border-border hover:border-blue-500/50",
                    )}
                  >
                    <ImagePlusIcon className="size-5 text-blue-600 dark:text-blue-400" aria-hidden />
                    <span><span className="font-medium">Choose images</span> or drag them here</span>
                    <span className="text-muted-foreground text-xs">PNG, JPEG, GIF, or WebP · 1 MB each</span>
                  </button>
                  {images.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {images.map((image) => (
                        <div key={image.id} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                          {/* The URL is a local object URL and never leaves the browser before upload. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.previewURL} alt={image.file.name} className="size-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeImage(image.id)}
                            className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full bg-background/90 shadow-sm xl:size-8"
                          >
                            <XIcon className="size-4" aria-hidden />
                            <span className="sr-only">Remove {image.file.name}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <FieldDescription>Screenshots make bugs much easier to diagnose.</FieldDescription>
                </Field>
                <Button type="submit" disabled={!canSubmit || !board || !title.trim() || isSubmitting}>
                  {isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <MessageSquareTextIcon data-icon="inline-start" />}
                  {isSubmitting ? "Publishing…" : "Publish feedback"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:pt-24">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Public by design</CardTitle>
              <CardDescription>Feedback is an open AT Protocol record associated with @{account.handle}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant="accent">Powered by User Input</Badge>
              <Button asChild variant="outline" className="w-full">
                <a href={board?.publicURL ?? "https://userinput.app"} target="_blank" rel="noreferrer">
                  View public board <ArrowUpRightIcon data-icon="inline-end" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
