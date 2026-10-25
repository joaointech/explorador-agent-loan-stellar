"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { cn } from "@/components/ui/cn";

import { setStoredTheme, type ThemePref } from "./theme";
import { useThemePref } from "./use-theme";

const OPTIONS: { key: ThemePref; label: string; icon: LucideIcon }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "system", label: "System", icon: Monitor },
  { key: "dark", label: "Dark", icon: Moon },
];

/**
 * Light / System / Dark segmented control (explorador.pt footer).
 * - `onPrimary`: on the blue footer (white-on-translucent track).
 * - `onSurface`: on a page or card.
 * Nothing is selected until hydration finishes, so SSR and client markup match.
 */
export function ThemeToggle({
  variant = "onSurface",
  showLabels = true,
  className,
}: {
  variant?: "onPrimary" | "onSurface";
  /** Labels show from `sm` up; icons only below. */
  showLabels?: boolean;
  className?: string;
}) {
  const pref = useThemePref();

  const track =
    variant === "onPrimary"
      ? "bg-white/10 ring-1 ring-white/15"
      : "bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700";
  const idle =
    variant === "onPrimary"
      ? "text-white/75 hover:text-white"
      : "text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white";
  const active =
    variant === "onPrimary"
      ? "bg-white text-slate-900 shadow-sm"
      : "bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white";

  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex items-center gap-0.5 rounded-full p-0.5", track, className)}>
      {OPTIONS.map(({ key, label, icon: Icon }) => {
        const selected = pref === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setStoredTheme(key)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors",
              selected ? active : idle,
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {showLabels && <span className="hidden sm:inline">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
