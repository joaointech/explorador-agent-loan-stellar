"use client";

import { THEME_INIT_SCRIPT } from "./theme";

/**
 * The no-flash theme script for <head> (Next docs: "Preventing flash before
 * hydration"). Server HTML gets an executable script that runs during parsing;
 * client renders get `text/plain`, so React never warns about (or re-runs) a
 * script it renders itself, e.g. when an error boundary re-renders the root.
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
