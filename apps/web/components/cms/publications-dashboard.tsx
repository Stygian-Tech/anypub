"use client";

import { format, parseISO } from "date-fns";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { PublicationIcon } from "@/components/cms/publication-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import type { Publication } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PublicationsDashboard({
  publications,
  isSyncing,
  onSync,
}: {
  publications: Publication[];
  isSyncing: boolean;
  onSync: () => void;
}) {
  const latestSync = publications.reduce<string | undefined>((latest, publication) => {
    if (!latest || publication.syncedAt > latest) return publication.syncedAt;
    return latest;
  }, undefined);

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-muted/20">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">Account inventory</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Publications</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {publications.length === 1
                ? "1 publication is available to AnyPub."
                : `${publications.length} publications are available to AnyPub.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {latestSync ? (
              <span className="text-muted-foreground text-xs">
                Synced {format(parseISO(latestSync), "MMM d, yyyy 'at' h:mm a")}
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={onSync} disabled={isSyncing}>
              <RefreshCwIcon data-icon="inline-start" className={cn(isSyncing && "animate-spin")} />
              {isSyncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </div>

        {publications.length ? (
          <div className="divide-y border-b">
            {publications.map((publication) => (
              <article key={publication.uri} className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <div className="flex min-w-0 items-start gap-4">
                  <PublicationIcon publication={publication} className="size-12 rounded-lg" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">{publication.name}</h2>
                      <Badge variant="outline" className="font-normal">
                        {publication.host ?? "standard.site"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 truncate text-xs">{publication.url}</p>
                    {publication.description ? (
                      <p className="text-muted-foreground mt-2 line-clamp-2 max-w-2xl text-sm">{publication.description}</p>
                    ) : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <a href={publication.url} target="_blank" rel="noreferrer">
                    View site
                    <ExternalLinkIcon data-icon="inline-end" />
                  </a>
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <Empty className="mt-8 min-h-64 border">
            <EmptyTitle>No publications found</EmptyTitle>
            <EmptyDescription>
              Sync again after creating a site.standard publication on this account.
            </EmptyDescription>
          </Empty>
        )}
      </div>
    </section>
  );
}
