// Date and time formatting (spec §10.1): dates as `14 Jan 2027`, times in
// Europe/Lisbon, 24-hour clock. Output is identical on the server and in the
// browser (fixed locale, fixed time zone, fixed month names), so formatted
// dates never cause hydration mismatches.

import { DAY_SECS } from "../units";

/** Where explorador operates; every wall-clock time is shown in this zone. */
export const APP_TIME_ZONE = "Europe/Lisbon";

/**
 * Anything that names a moment or a day:
 * - `Date`
 * - ISO-8601 string (`IsoTime` fields)
 * - number or bigint: a protocol **day number** (days since the Unix epoch, UTC)
 *   when below 10^7, **unix seconds** below 10^11, otherwise milliseconds.
 *   Day numbers below 10^7 cover the years 1970–29349 and unix seconds above
 *   10^7 start in April 1970, so the ranges never overlap for real data.
 */
export type DateInput = Date | string | number | bigint;

const DAY_NUMBER_LIMIT = 10_000_000;
const UNIX_SECONDS_LIMIT = 100_000_000_000;

// en-GB now abbreviates September as "Sept"; the spec's style is three letters.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** True when a numeric input is a day number rather than a timestamp. */
export function isDayNumber(input: DateInput): boolean {
  if (typeof input === "number") return Math.abs(input) < DAY_NUMBER_LIMIT;
  if (typeof input === "bigint") return (input < 0n ? -input : input) < BigInt(DAY_NUMBER_LIMIT);
  return false;
}

/** Normalizes a `DateInput` to a `Date` (see `DateInput` for how numbers are read). */
export function toDate(input: DateInput): Date {
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === "string") {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date string "${input}"`);
    return d;
  }
  const n = Number(input);
  if (!Number.isFinite(n)) throw new RangeError(`Invalid date value ${String(input)}`);
  const abs = Math.abs(n);
  if (abs < DAY_NUMBER_LIMIT) return new Date(n * DAY_SECS * 1000);
  if (abs < UNIX_SECONDS_LIMIT) return new Date(n * 1000);
  return new Date(n);
}

/** Unix seconds for any `DateInput`. Day numbers map to 00:00 UTC of that day. */
export function toUnixSeconds(input: DateInput): number {
  return Math.floor(toDate(input).getTime() / 1000);
}

interface Parts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(date: Date, timeZone: string): Parts {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partFormatters.set(timeZone, f);
  }
  const out: Parts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of f.formatToParts(date)) {
    if (p.type in out) out[p.type as keyof Parts] = Number(p.value);
  }
  return out;
}

/** Day numbers are calendar days (UTC); instants are shown in Europe/Lisbon. */
function zoneFor(input: DateInput, timeZone?: string): string {
  return timeZone ?? (isDayNumber(input) ? "UTC" : APP_TIME_ZONE);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface DateFormatOptions {
  /** Override the zone (default: Europe/Lisbon; UTC for day numbers). */
  timeZone?: string;
}

/** `14 Jan 2027`. */
export function formatDate(input: DateInput, options: DateFormatOptions = {}): string {
  const p = partsIn(toDate(input), zoneFor(input, options.timeZone));
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** `14 Jan` (no year), for compact axes and lists within the current year. */
export function formatShortDate(input: DateInput, options: DateFormatOptions = {}): string {
  const p = partsIn(toDate(input), zoneFor(input, options.timeZone));
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** `15:04` (or `15:04:09`), Europe/Lisbon, 24-hour clock. */
export function formatTime(input: DateInput, options: DateFormatOptions & { seconds?: boolean } = {}): string {
  const p = partsIn(toDate(input), options.timeZone ?? APP_TIME_ZONE);
  return options.seconds ? `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}` : `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** `14 Jan 2027, 15:04`, Europe/Lisbon. */
export function formatDateTime(input: DateInput, options: DateFormatOptions & { seconds?: boolean } = {}): string {
  const timeZone = options.timeZone ?? APP_TIME_ZONE;
  return `${formatDate(input, { timeZone })}, ${formatTime(input, { ...options, timeZone })}`;
}

/** `2027-01-14` in the display zone: for `<time dateTime>` and date inputs. */
export function toIsoDate(input: DateInput, options: DateFormatOptions = {}): string {
  const p = partsIn(toDate(input), zoneFor(input, options.timeZone));
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export interface DurationOptions {
  /** `long`: "3 days 4 hours"; `short`: "3d 4h". Default `long`. */
  style?: "long" | "short";
  /** How many units to show, largest first. Default 2. */
  maxUnits?: number;
}

const UNITS: { secs: number; long: string; short: string }[] = [
  { secs: DAY_SECS, long: "day", short: "d" },
  { secs: 3600, long: "hour", short: "h" },
  { secs: 60, long: "min", short: "m" },
  { secs: 1, long: "sec", short: "s" },
];

/** A length of time: `formatDuration(90061)` → "1 day 1 hour"; short style → "1d 1h". */
export function formatDuration(totalSecs: number, options: DurationOptions = {}): string {
  const { style = "long", maxUnits = 2 } = options;
  let rest = Math.max(0, Math.floor(Math.abs(totalSecs)));
  const parts: string[] = [];
  // Take `maxUnits` consecutive units starting at the largest non-zero one, so
  // 1 day 0 h 5 min reads "1 day" rather than skipping to "1 day 5 min".
  let taken = 0;
  for (const u of UNITS) {
    const n = Math.floor(rest / u.secs);
    rest -= n * u.secs;
    if (taken === 0 && n === 0) continue;
    taken += 1;
    if (n > 0) {
      if (style === "short") parts.push(`${n}${u.short}`);
      else if (u.long === "min" || u.long === "sec") parts.push(`${n} ${u.long}`);
      else parts.push(`${n} ${u.long}${n === 1 ? "" : "s"}`);
    }
    if (taken >= maxUnits) break;
  }
  if (parts.length === 0) return style === "short" ? "0s" : "0 sec";
  return parts.join(" ");
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DateInput, to: DateInput): number {
  return Math.floor(toUnixSeconds(to) / DAY_SECS) - Math.floor(toUnixSeconds(from) / DAY_SECS);
}

/** Countdown clock: "45d 03h 12m 09s" over a day, "03:12:09" under a day (negative → zero). */
export function formatCountdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / DAY_SECS);
  const h = Math.floor((s % DAY_SECS) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}d ${pad2(h)}h ${pad2(m)}m ${pad2(sec)}s` : `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

/** Days remaining as a status line: "45 days left", "Due tomorrow", "Due today", "Overdue by 3 days". */
export function formatDaysLeft(days: number): string {
  if (days > 1) return `${days} days left`;
  if (days === 1) return "Due tomorrow";
  if (days === 0) return "Due today";
  return `Overdue by ${-days} ${days === -1 ? "day" : "days"}`;
}

/**
 * Day-granular relative phrase from `now` to `target`: "today", "tomorrow",
 * "in 45 days", "yesterday", "3 days ago". Both are read as protocol-clock
 * moments (pass `protocolNow` as `now` for deals and grace periods).
 */
export function formatRelativeDays(target: DateInput, now: DateInput): string {
  const d = daysBetween(now, target);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}
