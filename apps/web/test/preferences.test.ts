import { describe, expect, it } from "vitest";
import {
  defaultColumnLayout,
  fontLabel,
  isDarkTheme,
  resolveFontPreference,
  resolveThemePreference,
  sanitizeColumnLayout,
} from "@/lib/preferences";

describe("preferences", () => {
  it("clamps persisted column widths to the supported desktop range", () => {
    expect(
      sanitizeColumnLayout({
        draftList: 900,
        metadataPanel: 420,
      }),
    ).toEqual({
      draftList: 480,
      metadataPanel: 420,
    });
  });

  it("falls back to default widths for invalid persisted values", () => {
    expect(
      sanitizeColumnLayout({
        draftList: "wide",
        metadataPanel: null,
      }),
    ).toEqual(defaultColumnLayout);
  });

  it("resolves unsupported theme values to system", () => {
    expect(resolveThemePreference("dark")).toBe("dark");
    expect(resolveThemePreference("light")).toBe("light");
    expect(resolveThemePreference("blue")).toBe("system");
    expect(resolveThemePreference(null)).toBe("system");
  });

  it("resolves font preferences and labels", () => {
    expect(resolveFontPreference("sans")).toBe("sans");
    expect(resolveFontPreference("serif")).toBe("serif");
    expect(resolveFontPreference("mono")).toBe("mono");
    expect(resolveFontPreference("display")).toBe("sans");
    expect(fontLabel("sans")).toBe("Sans");
    expect(fontLabel("serif")).toBe("Serif");
    expect(fontLabel("mono")).toBe("Mono");
  });

  it("maps system theme preference to the current media query state", () => {
    expect(isDarkTheme("system", true)).toBe(true);
    expect(isDarkTheme("system", false)).toBe(false);
    expect(isDarkTheme("dark", false)).toBe(true);
    expect(isDarkTheme("light", true)).toBe(false);
  });
});
