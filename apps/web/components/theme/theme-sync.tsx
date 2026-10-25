"use client";

import { useLayoutEffect } from "react";

import { applyTheme, getStoredTheme, subscribeTheme } from "./theme";

/**
 * Keeps <html> in sync with the stored theme. In production the head script
 * already did the work; in development React's Strict Mode remount resets the
 * attributes on <html>, so we re-apply before paint (Next docs: "Preventing
 * flash before hydration"). It also follows the OS while the preference is
 * "system", even on pages without a ThemeToggle.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme(getStoredTheme());
    return subscribeTheme(() => {});
  }, []);
  return null;
}
