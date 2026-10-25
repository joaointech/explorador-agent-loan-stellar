import type { ReactNode } from "react";

import { cn } from "./cn";
import { Skeleton } from "./skeleton";

export type StatPillSize = "sm" | "md" | "lg";

const VALUE_SIZES: Record<StatPillSize, string> = {
  sm: "text-xl font-bold",
  md: "text-2xl font-bold sm:text-3xl",
  lg: "text-3xl font-extrabold sm:text-4xl",
};

/**
 * Stat pill (spec §10.1, like "À VENDA AGORA · 375 420" on explorador.pt): a
 * small card with a tiny uppercase label over a big bold tabular number.
 *
 *   <StatPill label="Pool TVL" value={formatEur(stats.seniorAssets)} hint="senior + junior" />
 */
export function StatPill({
  label,
  value,
  hint,
  icon,
  size = "md",
  variant = "solid",
  tone = "default",
  loading = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small line under the value (unit, delta, context). */
  hint?: ReactNode;
  /** Optional icon shown before the label. */
  icon?: ReactNode;
  size?: StatPillSize;
  /** `glass` for warm or coloured sections; `solid` (white) elsewhere. */
  variant?: "solid" | "glass";
  /** `primary` renders the value in brand blue. */
  tone?: "default" | "primary";
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-card px-5 py-3.5",
        variant === "glass"
          ? "border border-slate-200/70 bg-white/60 shadow-pill backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/60"
          : "border border-line bg-card shadow-card",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.2em] text-muted uppercase [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      {loading ? (
        <Skeleton className={cn("mt-1.5 w-32", size === "lg" ? "h-9" : size === "md" ? "h-8" : "h-6")} />
      ) : (
        <span
          className={cn(
            "mt-1 truncate leading-none tracking-tight tabular-nums",
            VALUE_SIZES[size],
            tone === "primary" ? "text-primary-text" : "text-heading",
          )}
        >
          {value}
        </span>
      )}
      {hint && <span className="mt-1.5 text-xs font-medium text-muted">{hint}</span>}
    </div>
  );
}
