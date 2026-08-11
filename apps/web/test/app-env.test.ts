import { afterEach, describe, expect, it } from "vitest";
import {
  environmentBannerHeight,
  getAppEnv,
  normalizeAppEnv,
  shouldShowEnvironmentBanner,
} from "@/lib/app-env";

const env = process.env as Record<string, string | undefined>;
const original = {
  NEXT_PUBLIC_APP_ENV: env.NEXT_PUBLIC_APP_ENV,
  APP_ENV: env.APP_ENV,
  NODE_ENV: env.NODE_ENV,
};

afterEach(() => {
  env.NEXT_PUBLIC_APP_ENV = original.NEXT_PUBLIC_APP_ENV;
  env.APP_ENV = original.APP_ENV;
  env.NODE_ENV = original.NODE_ENV;
});

describe("application environment", () => {
  it("uses the configured public or server environment", () => {
    env.NEXT_PUBLIC_APP_ENV = "dev";
    env.APP_ENV = "local";
    expect(getAppEnv()).toBe("dev");

    delete env.NEXT_PUBLIC_APP_ENV;
    expect(getAppEnv()).toBe("local");
  });

  it("defaults local development to local and hosted builds to prod", () => {
    delete env.NEXT_PUBLIC_APP_ENV;
    delete env.APP_ENV;
    env.NODE_ENV = "development";
    expect(getAppEnv()).toBe("local");
    env.NODE_ENV = "production";
    expect(getAppEnv()).toBe("prod");
  });

  it("shows banners only for local and dev", () => {
    expect(normalizeAppEnv("production")).toBe("prod");
    expect(normalizeAppEnv("development")).toBe("dev");
    expect(shouldShowEnvironmentBanner("local")).toBe(true);
    expect(shouldShowEnvironmentBanner("dev")).toBe(true);
    expect(shouldShowEnvironmentBanner("prod")).toBe(false);
    expect(environmentBannerHeight("dev")).toBe("2.25rem");
    expect(environmentBannerHeight("prod")).toBe("0px");
  });
});
