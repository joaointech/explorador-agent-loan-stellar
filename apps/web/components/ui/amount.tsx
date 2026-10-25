import type { ElementType } from "react";

import { EMPTY_VALUE, formatEur, toCents, type AmountInput, type FormatEurOptions } from "@/lib/format";

import { cn } from "./cn";

/**
 * A euro amount: stroops string/bigint (the API default) → `€3,750.00`,
 * tabular figures, never wrapping. null/undefined render "—".
 *
 *   <Amount value={line.creditLimit} />                    // stroops
 *   <Amount value={6200} unit="cents" />
 *   <Amount value={payout} sign="always" tone="auto" />    // +€4,411.23 in green
 *   <Amount value={tvl} subtleCents className="text-4xl font-bold" />
 */
export function Amount({
  value,
  unit = "stroops",
  decimals,
  compact,
  sign,
  tone = "default",
  subtleCents = false,
  as: Tag = "span",
  className,
}: {
  value: AmountInput | null | undefined;
  /** `auto`: negative red; positive green when a sign is shown. `muted` greys it out. */
  tone?: "default" | "auto" | "positive" | "negative" | "muted";
  /** Render the cents smaller and muted (big dashboard numbers). */
  subtleCents?: boolean;
  as?: ElementType;
  className?: string;
} & FormatEurOptions) {
  if (value === null || value === undefined || value === "") {
    return <Tag className={cn("tabular-nums text-subtle", className)}>{EMPTY_VALUE}</Tag>;
  }

  const text = formatEur(value, { unit, decimals, compact, sign });
  const cents = toCents(value, unit);
  const toneClass =
    tone === "positive" || (tone === "auto" && cents > 0n && (sign === "always" || sign === "exceptZero"))
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative" || (tone === "auto" && cents < 0n)
        ? "text-red-600 dark:text-red-400"
        : tone === "muted"
          ? "text-muted"
          : undefined;

  const dot = subtleCents && !compact ? text.lastIndexOf(".") : -1;
  return (
    <Tag className={cn("tabular-nums whitespace-nowrap", toneClass, className)}>
      {dot > 0 ? (
        <>
          {text.slice(0, dot)}
          <span className="text-[0.6em] font-semibold text-muted">{text.slice(dot)}</span>
        </>
      ) : (
        text
      )}
    </Tag>
  );
}
