"use client";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function EditorAccessState({
  state,
  onRetry,
}: {
  state: "loading" | "redirecting" | "error";
  onRetry?: () => void;
}) {
  if (state === "error") {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6">
        <Empty className="w-full max-w-md bg-background">
          <EmptyTitle>AnyPub could not load your session</EmptyTitle>
          <EmptyDescription>The account service may be temporarily unavailable.</EmptyDescription>
          {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button> : null}
        </Empty>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 text-sm text-muted-foreground">
      {state === "loading" ? "Loading editor…" : "Taking you to sign in…"}
    </main>
  );
}
