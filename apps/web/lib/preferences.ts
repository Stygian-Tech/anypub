export type ThemePreference = "light" | "dark" | "system";
export type FontPreference = "sans" | "serif" | "mono";

export type ColumnLayout = {
  draftList: number;
  metadataPanel: number;
};

export const themePreferences: ThemePreference[] = ["light", "dark", "system"];
export const fontPreferences: FontPreference[] = ["sans", "serif", "mono"];

export const defaultColumnLayout: ColumnLayout = {
  draftList: 320,
  metadataPanel: 360,
};

export const columnLayoutBounds: Record<keyof ColumnLayout, { min: number; max: number }> = {
  draftList: { min: 260, max: 480 },
  metadataPanel: { min: 300, max: 520 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function numericValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sanitizeColumnLayout(value: Partial<Record<keyof ColumnLayout, unknown>> = {}): ColumnLayout {
  return {
    draftList: clamp(
      numericValue(value.draftList, defaultColumnLayout.draftList),
      columnLayoutBounds.draftList.min,
      columnLayoutBounds.draftList.max,
    ),
    metadataPanel: clamp(
      numericValue(value.metadataPanel, defaultColumnLayout.metadataPanel),
      columnLayoutBounds.metadataPanel.min,
      columnLayoutBounds.metadataPanel.max,
    ),
  };
}

export function resolveThemePreference(value: string | null | undefined): ThemePreference {
  return themePreferences.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
}

export function resolveFontPreference(value: string | null | undefined): FontPreference {
  return fontPreferences.includes(value as FontPreference) ? (value as FontPreference) : "sans";
}

export function fontLabel(preference: FontPreference) {
  switch (preference) {
    case "sans":
      return "Sans";
    case "serif":
      return "Serif";
    case "mono":
      return "Mono";
  }
}

export function isDarkTheme(preference: ThemePreference, systemPrefersDark: boolean) {
  return preference === "dark" || (preference === "system" && systemPrefersDark);
}
