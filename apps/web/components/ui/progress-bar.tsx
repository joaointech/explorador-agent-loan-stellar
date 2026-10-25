import type { ReactNode } from "react";

import { cn } from "./cn";

export type ProgressTone = "auto" | "blue" | "emerald" | "amber" | "red";

const FILL: Record<Exclude<ProgressTone, "auto">, string> = {
  blue: "bg-primary",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

/** value / max as a 0–1 fraction; bigint-safe (stroops), clamped. */
export function progressFraction(value: number | bigint, max: number | bigint): number {
  if (typeof value === "bigint" || typeof max === "bigint") {
    const v = BigInt(value);
    const m = BigInt(max);
    if (m <= 0n) return 0;
    const f = Number((v * 1_000_000n) / m) / 1_000_000;
    return Math.min(1, Math.max(0, f));
  }
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * Horizontal progress bar (credit used, leverage vs cap, utilization).
 * `tone="auto"`: blue below 70 %, amber below 90 %, red above. `marker` draws a
 * tick at a fraction (e.g. a soft limit).
 *
 *   <ProgressBar label="Leverage" value={stats.leverageX100} max={1000} valueText="2.45× of 10×" />
 */
export function ProgressBar({
  value,
  max = 100,
  tone = "blue",
  size = "md",
  label,
  valueText,
  showValue = false,
  marker,
  className,
}: {
  value: number | bigint;
  max?: number | bigint;
  tone?: ProgressTone;
  size?: "sm" | "md" | "lg";
  /** Visible label above the bar (also the accessible name). */
  label?: ReactNode;
  /** Human text for the value (screen readers and the right-hand label), e.g. "€2,625.00 of €3,750.00". */
  valueText?: string;
  /** Show `valueText` (or the percentage) to the right of the label. */
  showValue?: boolean;
  /** Fraction 0–1 where a tick mark is drawn. */
  marker?: number;
  className?: string;
}) {
  const fraction = progressFraction(value, max);
  const percent = Math.round(fraction * 1000) / 10;
  const resolved = tone === "auto" ? (fraction < 0.7 ? "blue" : fraction < 0.9 ? "amber" : "red") : tone;
  const text = valueText ?? `${percent}%`;
  const height = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";

  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          {label && <span className="font-medium text-heading">{label}</span>}
          {showValue && <span className="tabular-nums text-muted">{text}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={text}
        aria-label={typeof label === "string" ? label : undefined}
        className={cn("relative w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/70", height)}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", FILL[resolved])}
          style={{ width: `${fraction * 100}%` }}
        />
        {marker !== undefined && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-slate-500/70 dark:bg-slate-300/70"
            style={{ left: `calc(${Math.min(1, Math.max(0, marker)) * 100}% - 1px)` }}
          />
        )}
      </div>
    </div>
  );
}
