export type AppEnv = "prod" | "dev" | "local" | (string & {});

export function normalizeAppEnv(raw: string): AppEnv {
  const value = raw.trim().toLowerCase();
  if (value === "production") return "prod";
  if (value === "development") return "dev";
  return value as AppEnv;
}

export function getAppEnv(): AppEnv {
  const configured =
    process.env.NEXT_PUBLIC_APP_ENV?.trim() ||
    process.env.APP_ENV?.trim();

  if (configured) return normalizeAppEnv(configured);
  return process.env.NODE_ENV === "development" ? "local" : "prod";
}

export function shouldShowEnvironmentBanner(appEnv: AppEnv): boolean {
  return appEnv === "local" || appEnv === "dev";
}

export const ENVIRONMENT_BANNER_HEIGHT = "2.25rem" as const;

export function environmentBannerHeight(appEnv: AppEnv): string {
  return shouldShowEnvironmentBanner(appEnv)
    ? ENVIRONMENT_BANNER_HEIGHT
    : "0px";
}
