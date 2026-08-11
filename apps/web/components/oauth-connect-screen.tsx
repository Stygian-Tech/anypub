"use client";

import * as React from "react";
import { LoaderCircleIcon, LogInIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { APIError } from "@/lib/api";
import { startOAuth } from "@/lib/oauth-api";

export function OAuthConnectScreen({
  accountLoadFailed = false,
  onRetry,
}: {
  accountLoadFailed?: boolean;
  onRetry?: () => void;
}) {
  const [handle, setHandle] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isStarting, setIsStarting] = React.useState(false);

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!handle.trim() || isStarting) return;

    setError(null);
    setIsStarting(true);
    try {
      const result = await startOAuth(handle, `${window.location.origin}/`);
      window.location.assign(result.authorizationURL);
    } catch (caught) {
      setError(caught instanceof APIError ? caught.message : "Could not start AT Protocol OAuth.");
      setIsStarting(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Connect your publication account</CardTitle>
          <CardDescription>
            AnyPub uses AT Protocol OAuth to discover your publications and publish with your approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountLoadFailed ? (
            <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p>AnyPub could not reach the account service.</p>
              {onRetry ? (
                <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
                  <RotateCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={connect}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="atproto-handle">Handle</FieldLabel>
                <Input
                  id="atproto-handle"
                  name="handle"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="you.example.com"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  disabled={isStarting || accountLoadFailed}
                  required
                />
                <FieldDescription>Use your AT Protocol handle or did:plc identifier.</FieldDescription>
              </Field>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={!handle.trim() || isStarting || accountLoadFailed}>
                {isStarting ? (
                  <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <LogInIcon data-icon="inline-start" />
                )}
                {isStarting ? "Connecting…" : "Continue with AT Protocol"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
