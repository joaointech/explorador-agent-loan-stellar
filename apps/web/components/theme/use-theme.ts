"use client";

import { useSyncExternalStore } from "react";

import { getResolvedTheme, getStoredTheme, subscribeTheme, type ResolvedTheme, type ThemePref } from "./theme";

/** The stored preference, or null during SSR and hydration (the server can't know it). */
export function useThemePref(): ThemePref | null {
  return useSyncExternalStore(subscribeTheme, getStoredTheme, () => null);
}

/** The painted theme. "light" during SSR/hydration, then the real value. Use for charts and canvases. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, () => "light" as const);
}
