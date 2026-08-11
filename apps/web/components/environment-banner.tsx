import {
  shouldShowEnvironmentBanner,
  type AppEnv,
} from "@/lib/app-env";
import { cn } from "@/lib/utils";

export function EnvironmentBanner({ appEnv }: { appEnv: AppEnv }) {
  if (!shouldShowEnvironmentBanner(appEnv)) return null;

  return (
    <div
      role="status"
      aria-label={`${appEnv} environment`}
      className={cn(
        "flex h-9 shrink-0 items-center justify-center border-b px-4 text-xs font-semibold uppercase tracking-[0.18em]",
        appEnv === "local"
          ? "border-amber-400/60 bg-amber-300/25 text-amber-950 dark:border-amber-300/40 dark:bg-amber-400/15 dark:text-amber-100"
          : "border-red-400/60 bg-red-400/20 text-red-950 dark:border-red-300/40 dark:bg-red-500/15 dark:text-red-100",
      )}
    >
      {appEnv}
    </div>
  );
}
