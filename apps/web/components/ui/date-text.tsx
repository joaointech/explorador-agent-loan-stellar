import {
  EMPTY_VALUE,
  formatDate,
  formatDateTime,
  formatRelativeDays,
  formatTime,
  isDayNumber,
  toDate,
  toIsoDate,
  type DateInput,
} from "@/lib/format";

import { cn } from "./cn";

/**
 * A date in a <time> element: `14 Jan 2027` (Europe/Lisbon), with the full
 * date-time in the tooltip. Accepts day numbers (escrituraDay), unix seconds
 * (protocol clock), ISO strings or Dates. Deterministic, so it never causes
 * hydration mismatches.
 *
 *   <DateText value={note.escrituraDay} />
 *   <DateText value={item.at} format="datetime" />
 *   <DateText value={note.escrituraDay} format="relative" now={clock.protocolNow} />  // "in 45 days"
 */
export function DateText({
  value,
  format = "date",
  now,
  className,
}: {
  value: DateInput | null | undefined;
  format?: "date" | "datetime" | "time" | "relative";
  /** Reference "now" for `relative` (pass the protocol clock for deals). */
  now?: DateInput;
  className?: string;
}) {
  if (value === null || value === undefined || value === "") {
    return <span className={cn("text-subtle", className)}>{EMPTY_VALUE}</span>;
  }
  const day = isDayNumber(value);
  const iso = day ? toIsoDate(value) : toDate(value).toISOString();
  const text =
    format === "datetime"
      ? formatDateTime(value)
      : format === "time"
        ? formatTime(value)
        : format === "relative" && now !== undefined
          ? formatRelativeDays(value, now)
          : formatDate(value);
  const title = day ? formatDate(value) : `${formatDateTime(value)} (Lisbon)`;
  return (
    <time dateTime={iso} title={title} className={cn("tabular-nums whitespace-nowrap", className)}>
      {text}
    </time>
  );
}
