"use client";

import * as React from "react";
import {
  isDarkTheme,
  resolveFontPreference,
  resolveThemePreference,
  type FontPreference,
  type ThemePreference,
} from "@/lib/preferences";

const themeStorageKey = "anypub:theme";
const fontStorageKey = "anypub:font";
const boldTextStorageKey = "anypub:bold-text";
const smallTextStorageKey = "anypub:small-text";

export function useAppearancePreferences() {
  const [themePreference, setThemePreference] = React.useState<ThemePreference>("light");
  const [fontPreference, setFontPreference] = React.useState<FontPreference>("sans");
  const [boldText, setBoldText] = React.useState(false);
  const [smallText, setSmallText] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedTheme = window.localStorage.getItem(themeStorageKey);
      setThemePreference(storedTheme ? resolveThemePreference(storedTheme) : "light");
      setFontPreference(resolveFontPreference(window.localStorage.getItem(fontStorageKey)));
      setBoldText(window.localStorage.getItem(boldTextStorageKey) === "1");
      setSmallText(window.localStorage.getItem(smallTextStorageKey) === "1");
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => applyThemePreference(themePreference);
    applyTheme();
    if (themePreference !== "system") return;
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [hydrated, themePreference]);

  React.useEffect(() => {
    if (!hydrated) return;
    applyFontPreference(fontPreference);
    applyBooleanPreference("boldText", boldTextStorageKey, boldText);
    applyBooleanPreference("smallText", smallTextStorageKey, smallText);
  }, [boldText, fontPreference, hydrated, smallText]);

  function changeThemePreference(preference: ThemePreference) {
    applyThemePreference(preference);
    setThemePreference(preference);
  }

  function changeFontPreference(preference: FontPreference) {
    applyFontPreference(preference);
    setFontPreference(preference);
  }

  function changeBoldText(enabled: boolean) {
    applyBooleanPreference("boldText", boldTextStorageKey, enabled);
    setBoldText(enabled);
  }

  function changeSmallText(enabled: boolean) {
    applyBooleanPreference("smallText", smallTextStorageKey, enabled);
    setSmallText(enabled);
  }

  return {
    themePreference,
    fontPreference,
    boldText,
    smallText,
    changeThemePreference,
    changeFontPreference,
    changeBoldText,
    changeSmallText,
  };
}

function applyThemePreference(preference: ThemePreference) {
  const shouldUseDarkTheme = isDarkTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  document.documentElement.classList.toggle("dark", shouldUseDarkTheme);
  document.documentElement.dataset.theme = shouldUseDarkTheme ? "dark" : "light";
  document.documentElement.style.colorScheme = shouldUseDarkTheme ? "dark" : "light";
  window.localStorage.setItem(themeStorageKey, preference);
}

function applyFontPreference(preference: FontPreference) {
  document.documentElement.dataset.font = preference;
  if (preference === "sans") window.localStorage.removeItem(fontStorageKey);
  else window.localStorage.setItem(fontStorageKey, preference);
}

function applyBooleanPreference(
  dataKey: "boldText" | "smallText",
  storageKey: string,
  enabled: boolean,
) {
  document.documentElement.dataset[dataKey] = enabled ? "true" : "false";
  if (enabled) window.localStorage.setItem(storageKey, "1");
  else window.localStorage.removeItem(storageKey);
}
