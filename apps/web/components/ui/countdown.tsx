"use client";

import {
  daysBetween,
  formatCountdown,
  formatDateTime,
  formatDaysLeft,
  isDayNumber,
  toDate,
  toIsoDate,
  toUnixSeconds,
  type DateInput,
} from "@/lib/format";

import { cn } from "./cn";
import { useNow } from "./use-now";

/**
 * Live countdown to an escritura date or grace deadline on the **protocol
 * clock**. Pass the API's `protocolNow` (and `fetchedAtMs` to keep it ticking);
 * without `now` it counts against the wall clock.
 *
 *   <Countdown to={deal.escrituraDay} now={rates.protocolNow} fetchedAtMs={rates.fetchedAtMs} />
 *   <Countdown to={position.graceDeadline} now={…} fetchedAtMs={…} variant="precise" />
 */
export function Countdown({
  to,
  now,
  fetchedAtMs,
  variant = "days",
  className,
}: {
  to: DateInput;
  /** Protocol "now" in unix seconds, as returned by the API. */
  now?: number;
  /** Wall-clock ms when `now` was fetched; enables ticking. */
  fetchedAtMs?: number;
  /** `days`: "45 days left" (updates each minute); `precise`: "45d 03h 12m 09s" (each second). */
  variant?: "days" | "precise";
  className?: string;
}) {
  const wall = useNow(variant === "precise" ? 1000 : 60_000);
  const target = toUnixSeconds(to);
  const current =
    now === undefined
      ? wall === null
        ? null
        : wall / 1000
      : fetchedAtMs !== undefined && wall !== null
        ? now + Math.max(0, wall - fetchedAtMs) / 1000
        : now;

  const iso = isDayNumber(to) ? toIsoDate(to) : toDate(to).toISOString();
  const title = `${isDayNumber(to) ? "Due" : "Ends"} ${formatDateTime(to)} (Lisbon, protocol clock)`;

  if (current === null) {
    // Wall-clock countdown before hydration: render a stable placeholder.
    return (
      <time dateTime={iso} title={title} className={cn("tabular-nums text-muted", className)}>
        …
      </time>
    );
  }

  const remaining = target - current;
  const overdue = remaining < 0;
  let text: string;
  if (variant === "precise") {
    text = overdue ? `Overdue by ${formatCountdown(-remaining)}` : formatCountdown(remaining);
  } else {
    text = formatDaysLeft(daysBetween(current, target));
  }

  return (
    <time
      dateTime={iso}
      title={title}
      className={cn("tabular-nums whitespace-nowrap", overdue && "font-semibold text-orange-600 dark:text-orange-400", className)}
    >
      {text}
    </time>
  );
}
