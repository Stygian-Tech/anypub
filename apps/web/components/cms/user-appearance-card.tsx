"use client";

import * as React from "react";
import { AArrowDownIcon, BaselineIcon, BoldIcon, BookOpenIcon, TypeIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { fontLabel, type FontPreference } from "@/lib/preferences";
import type { LinkedAccount } from "@/lib/types";
import { cn } from "@/lib/utils";

function AccountAvatar({
  account,
  className,
}: {
  account?: LinkedAccount;
  className?: string;
}) {
  const displayName = account?.displayName || account?.handle || "No account";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AP";

  return (
    <div
      role={account?.avatarURL ? "img" : undefined}
      aria-label={account?.avatarURL ? `${displayName} profile picture` : undefined}
      className={cn(
        "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-cover bg-center text-sm font-medium",
        className,
      )}
      style={account?.avatarURL ? { backgroundImage: `url(${account.avatarURL})` } : undefined}
    >
      {account?.avatarURL ? null : <span>{initials}</span>}
    </div>
  );
}

const fontOptions: Array<{
  value: FontPreference;
  label: string;
  icon: typeof TypeIcon;
  style: React.CSSProperties;
}> = [
  {
    value: "sans",
    label: "Sans",
    icon: TypeIcon,
    style: { fontFamily: "var(--font-sans-system)" },
  },
  {
    value: "serif",
    label: "Serif",
    icon: BookOpenIcon,
    style: { fontFamily: "var(--font-serif-system)" },
  },
  {
    value: "mono",
    label: "Mono",
    icon: BaselineIcon,
    style: { fontFamily: "var(--font-mono-system)" },
  },
];

export function UserAppearanceCard({
  account,
  fontPreference,
  boldText,
  smallText,
  onFontPreferenceChange,
  onBoldTextChange,
  onSmallTextChange,
}: {
  account?: LinkedAccount;
  fontPreference: FontPreference;
  boldText: boolean;
  smallText: boolean;
  onFontPreferenceChange: (preference: FontPreference) => void;
  onBoldTextChange: (enabled: boolean) => void;
  onSmallTextChange: (enabled: boolean) => void;
}) {
  const displayName = account?.displayName || account?.handle || "No account";
  const handle = account?.handle ? `@${account.handle}` : "OAuth account required";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="user-card"
          className="hover:bg-accent focus-visible:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-3 border-t p-3 text-left outline-none transition-colors focus-visible:ring-2"
        >
          <AccountAvatar account={account} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{displayName}</span>
            <span className="text-muted-foreground block truncate text-xs">{handle}</span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription className="sr-only">Choose the editor font, text size, and weight.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Font</h3>
              <span className="text-muted-foreground text-xs">
                {fontLabel(fontPreference)}
                {boldText ? " + Bold" : ""}
                {smallText ? " + Small" : ""}
              </span>
            </div>
            <div role="radiogroup" aria-label="Font" className="mt-3 grid gap-2 sm:grid-cols-3">
              {fontOptions.map((option) => {
                const active = option.value === fontPreference;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`font-${option.value}`}
                    onClick={() => onFontPreferenceChange(option.value)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground",
                    )}
                  >
                    <Icon data-icon="inline-start" className="text-primary" />
                    <span
                      className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium text-foreground"
                      style={{ ...option.style, fontWeight: boldText ? 700 : 400 }}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            data-testid="font-bold"
            aria-pressed={boldText}
            onClick={() => onBoldTextChange(!boldText)}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              boldText
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground",
            )}
          >
            <BoldIcon data-icon="inline-start" className="text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Bold Text</span>
            <span className="text-muted-foreground text-xs">{boldText ? "On" : "Off"}</span>
          </button>

          <button
            type="button"
            data-testid="font-small"
            aria-pressed={smallText}
            onClick={() => onSmallTextChange(!smallText)}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              smallText
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground",
            )}
          >
            <AArrowDownIcon data-icon="inline-start" className="text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Smaller Text</span>
            <span className="text-muted-foreground text-xs">{smallText ? "On" : "Off"}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


