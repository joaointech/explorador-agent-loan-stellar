// Light / System / Dark theme, ported from explorador.pt (lib/theme.ts).
//
// We store the *preference* ("light" | "dark" | "system") in localStorage under
// `theme`, not the resolved value, so "system" keeps following the OS. The
// resolved value is applied as a `.dark` class on <html> plus `color-scheme`;
// globals.css keys the dark palette and the `dark:` variant off that class.
//
// THEME_INIT_SCRIPT runs render-blocking in <head> (see app/layout.tsx), so the
// class is on <html> before first paint: no light flash on a dark load. Keep it
// in sync with the helpers below; they encode the same rule.

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
const THEME_EVENT = "advance:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const THEME_INIT_SCRIPT = `(function(){try{var e=localStorage.getItem('${THEME_STORAGE_KEY}');var m=window.matchMedia('${DARK_QUERY}').matches;var d=e==='dark'||(e!=='light'&&m);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

/** Stored preference; "system" when unset, invalid or storage is blocked. Client only. */
export function getStoredTheme(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isPref(v)) return v;
  } catch {
    // Private mode or blocked storage: follow the OS.
  }
  return "system";
}

/** Resolves a preference against the OS setting. Client only. */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "system") return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  return pref;
}

/** Applies a preference to <html>. Idempotent. Client only. */
export function applyTheme(pref: ThemePref): void {
  const dark = resolveTheme(pref) === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/** Persists a preference (clearing storage for "system"), applies it and notifies subscribers. */
export function setStoredTheme(pref: ThemePref): void {
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // The live document still updates below.
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** The theme currently painted (reads the class the init script / applyTheme set). Client only. */
export function getResolvedTheme(): ResolvedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Subscribes to theme changes from this tab (toggle), other tabs (storage) and
 * the OS (while on "system"). Re-applies the stored preference before notifying,
 * so every subscriber reads the up-to-date class. For `useSyncExternalStore`.
 */
export function subscribeTheme(onChange: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  const reapply = () => {
    applyTheme(getStoredTheme());
    onChange();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY) reapply();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  mq.addEventListener("change", reapply);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", reapply);
  };
}
