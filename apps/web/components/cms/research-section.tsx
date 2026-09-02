"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import {
  ArrowUpRightIcon,
  BookMarkedIcon,
  HighlighterIcon,
  LibraryBigIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  loadResearch,
  type MarginResearchAnnotation,
  type ResearchResponse,
  type SembleResearchCard,
  type SembleResearchCollection,
} from "@/lib/research-api";
import { materialFromMargin, materialFromSemble, type ResearchPostMaterial } from "@/lib/research-composer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ResearchActions = {
  onUseInPost: (material: ResearchPostMaterial) => void;
  canUseInPost?: boolean;
};

export function ResearchSection({ onUseInPost, canUseInPost = true }: ResearchActions) {
  const [research, setResearch] = React.useState<ResearchResponse | null>(null);
  const [error, setError] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [refreshVersion, setRefreshVersion] = React.useState(0);

  const refresh = React.useCallback(() => {
    setIsLoading(true);
    setError("");
    setRefreshVersion((version) => version + 1);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    loadResearch(controller.signal)
      .then(setResearch)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Could not load research.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [refreshVersion]);

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-muted/20">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">Your AT Protocol library</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Research</h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-6">
              Turn your Semble links and Margin quotes and comments into your next post.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCwIcon data-icon="inline-start" className={isLoading ? "animate-spin" : undefined} />
            {isLoading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {isLoading && !research ? (
          <div className="text-muted-foreground flex min-h-64 items-center justify-center gap-2 text-sm">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden /> Loading your research…
          </div>
        ) : error ? (
          <Empty className="mt-8 min-h-64">
            <EmptyTitle>Research is unavailable</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
            <Button variant="outline" size="sm" onClick={refresh}>Try again</Button>
          </Empty>
        ) : research ? (
          <Tabs defaultValue="semble" className="mt-6 gap-5">
            <TabsList aria-label="Research sources">
              <TabsTrigger value="semble">
                <LibraryBigIcon className="mr-2 size-4" aria-hidden />
                Semble <span className="text-muted-foreground ml-1.5">{research.semble.collections.length}</span>
              </TabsTrigger>
              <TabsTrigger value="margin">
                <HighlighterIcon className="mr-2 size-4" aria-hidden />
                Margin <span className="text-muted-foreground ml-1.5">{research.margin.annotations.length}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="semble">
              <SourceNotice message={research.semble.error} />
              <SembleCollections collections={research.semble.collections} onUseInPost={onUseInPost} canUseInPost={canUseInPost} />
            </TabsContent>
            <TabsContent value="margin">
              <SourceNotice message={research.margin.error} />
              <MarginAnnotations annotations={research.margin.annotations} onUseInPost={onUseInPost} canUseInPost={canUseInPost} />
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </section>
  );
}

function SourceNotice({ message }: { message?: string }) {
  return message ? (
    <div role="status" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      {message}
    </div>
  ) : null;
}

function SembleCollections({ collections, ...actions }: { collections: SembleResearchCollection[] } & ResearchActions) {
  if (!collections.length) {
    return (
      <Empty className="min-h-64">
        <EmptyTitle>No Semble collections found</EmptyTitle>
        <EmptyDescription>Collections saved by this linked account will appear here.</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="grid gap-5">
      {collections.map((collection) => (
        <Card key={collection.uri}>
          <CardHeader className="gap-2 border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-none">{collection.name}</h2>
                {collection.description ? <CardDescription className="mt-1 leading-5">{collection.description}</CardDescription> : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{collection.accessType.toLowerCase()}</Badge>
                <Badge variant="secondary">{collection.cards.length} {collection.cards.length === 1 ? "item" : "items"}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {collection.cards.length ? collection.cards.map((card) => (
              <SembleCard key={card.uri} card={card} {...actions} />
            )) : (
              <p className="text-muted-foreground p-4 text-sm">This collection is empty.</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SembleCard({ card, onUseInPost, canUseInPost }: { card: SembleResearchCard } & ResearchActions) {
  const title = card.title || card.note || card.url || "Untitled saved item";
  return (
    <article className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold leading-5">{title}</h3>
          {card.siteName ? <Badge variant="outline" className="font-normal">{card.siteName}</Badge> : null}
        </div>
        {card.author ? <p className="text-muted-foreground mt-1 text-xs">By {card.author}</p> : null}
        {card.note && card.note !== title ? <p className="mt-2 text-sm leading-6">{card.note}</p> : null}
        {card.description ? <p className="text-muted-foreground mt-2 line-clamp-3 text-sm leading-6">{card.description}</p> : null}
        {card.createdAt ? <ResearchDate value={card.createdAt} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
      <UseInPostButton material={materialFromSemble(card)} onUseInPost={onUseInPost} canUseInPost={canUseInPost} />
      {safeHTTPURL(card.url) ? (
        <Button variant="ghost" size="sm" asChild>
          <a href={card.url} target="_blank" rel="noreferrer">
            Open source <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </Button>
      ) : null}
      </div>
    </article>
  );
}

function MarginAnnotations({ annotations, onUseInPost, canUseInPost }: { annotations: MarginResearchAnnotation[] } & ResearchActions) {
  if (!annotations.length) {
    return (
      <Empty className="min-h-64">
        <EmptyTitle>No Margin annotations found</EmptyTitle>
        <EmptyDescription>Notes, highlights, and bookmarks from this linked account will appear here.</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {annotations.map((annotation) => (
        <Card key={annotation.uri} className="min-w-0">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline" className="capitalize">
                <BookMarkedIcon className="mr-1 size-3" aria-hidden /> {annotation.motivation}
              </Badge>
              <ResearchDate value={annotation.modifiedAt ?? annotation.createdAt} />
            </div>
            <h2 className="text-base font-semibold leading-6">{annotation.title || sourceHost(annotation.source)}</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {annotation.quote ? (
              <blockquote className="border-l-2 border-primary/40 pl-3 text-sm leading-6 italic">“{annotation.quote}”</blockquote>
            ) : null}
            {annotation.body ? <p className="text-sm leading-6 whitespace-pre-wrap">{annotation.body}</p> : null}
            {annotation.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {annotation.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
            <UseInPostButton material={materialFromMargin(annotation)} onUseInPost={onUseInPost} canUseInPost={canUseInPost} />
            {safeHTTPURL(annotation.source) ? (
              <Button variant="ghost" size="sm" className="-ml-3" asChild>
                <a href={annotation.source} target="_blank" rel="noreferrer">
                  Open source <ArrowUpRightIcon data-icon="inline-end" />
                </a>
              </Button>
            ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function UseInPostButton({ material, onUseInPost, canUseInPost }: { material: ResearchPostMaterial } & ResearchActions) {
  const hasContent = Boolean(material.quote || material.sourceURL || material.comment);
  return (
    <Button variant="outline" size="sm" disabled={!canUseInPost || !hasContent} onClick={() => onUseInPost(material)}
      title={!canUseInPost ? "Waiting for your drafts. Reload the workspace if they remain unavailable." : !hasContent ? "This item has no quote, safe source link, or comment to add." : undefined}>
      <SquarePenIcon data-icon="inline-start" /> Use in post
    </Button>
  );
}

function ResearchDate({ value }: { value: string }) {
  let label: string;
  try {
    label = format(parseISO(value), "MMM d, yyyy");
  } catch {
    return null;
  }
  return <time dateTime={value} className="text-muted-foreground mt-2 block text-xs">{label}</time>;
}

function safeHTTPURL(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Untitled annotation";
  }
}
