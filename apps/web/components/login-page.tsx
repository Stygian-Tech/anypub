"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { OAuthConnectScreen } from "@/components/oauth-connect-screen";
import { Button } from "@/components/ui/button";
import { APIError } from "@/lib/api";
import { loadAccounts } from "@/lib/oauth-api";

export function LoginPage({ onAuthorize }: { onAuthorize?: (url: string) => void }) {
  const router = useRouter();
  const [loadState, setLoadState] = React.useState<"loading" | "signed-out" | "error">("loading");

  const loadSession = React.useCallback((signal?: AbortSignal) => {
    loadAccounts(signal)
      .then((accounts) => {
        if (accounts.length > 0) {
          router.replace("/editor");
          return;
        }
        setLoadState("signed-out");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState(error instanceof APIError && error.status === 401 ? "signed-out" : "error");
      });
  }, [router]);

  React.useEffect(() => {
    const controller = new AbortController();
    loadSession(controller.signal);
    return () => controller.abort();
  }, [loadSession]);

  if (loadState === "loading") {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        Checking your session…
      </main>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-muted/30">
      <div className="absolute left-4 top-4 z-10">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeftIcon data-icon="inline-start" /> Home
          </Link>
        </Button>
      </div>
      <OAuthConnectScreen
        accountLoadFailed={loadState === "error"}
        onRetry={() => {
          setLoadState("loading");
          loadSession();
        }}
        returnTo="/editor"
        onAuthorize={onAuthorize}
      />
    </div>
  );
}
