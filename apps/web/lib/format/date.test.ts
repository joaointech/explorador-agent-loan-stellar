import { describe, expect, it } from "vitest";

import {
  daysBetween,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelativeDays,
  formatShortDate,
  formatTime,
  isDayNumber,
  toDate,
  toIsoDate,
  toUnixSeconds,
} from "./date";

const DAY_MS = 86_400_000;
const JAN_14_2027_DAY = Date.UTC(2027, 0, 14) / DAY_MS; // 20832
const JAN_14_2027_16H = Date.UTC(2027, 0, 14, 16, 0) / 1000; // unix seconds

describe("toDate", () => {
  it("reads day numbers, unix seconds, milliseconds, ISO strings and Dates", () => {
    expect(JAN_14_2027_DAY).toBe(20832);
    expect(toDate(JAN_14_2027_DAY).toISOString()).toBe("2027-01-14T00:00:00.000Z");
    expect(toDate(BigInt(JAN_14_2027_DAY)).toISOString()).toBe("2027-01-14T00:00:00.000Z");
    expect(toDate(JAN_14_2027_16H).toISOString()).toBe("2027-01-14T16:00:00.000Z");
    expect(toDate(BigInt(JAN_14_2027_16H)).toISOString()).toBe("2027-01-14T16:00:00.000Z");
    expect(toDate(JAN_14_2027_16H * 1000).toISOString()).toBe("2027-01-14T16:00:00.000Z");
    expect(toDate("2027-01-14T16:00:00Z").toISOString()).toBe("2027-01-14T16:00:00.000Z");
    const d = new Date("2027-01-14T16:00:00Z");
    expect(toDate(d)).not.toBe(d);
    expect(toDate(d).getTime()).toBe(d.getTime());
  });

  it("classifies numbers", () => {
    expect(isDayNumber(20832)).toBe(true);
    expect(isDayNumber(1_800_000_000)).toBe(false);
    expect(isDayNumber("20832")).toBe(false);
  });

  it("rejects invalid input", () => {
    expect(() => toDate("not a date")).toThrow(RangeError);
    expect(() => toDate(Number.NaN)).toThrow(RangeError);
  });

  it("converts to unix seconds", () => {
    expect(toUnixSeconds(JAN_14_2027_DAY)).toBe(Date.UTC(2027, 0, 14) / 1000);
    expect(toUnixSeconds("2027-01-14T16:00:00.900Z")).toBe(JAN_14_2027_16H);
  });
});

describe("formatDate", () => {
  it("formats as `14 Jan 2027` from every input kind", () => {
    expect(formatDate(JAN_14_2027_DAY)).toBe("14 Jan 2027");
    expect(formatDate(JAN_14_2027_16H)).toBe("14 Jan 2027");
    expect(formatDate(new Date(Date.UTC(2027, 0, 14, 12)))).toBe("14 Jan 2027");
    expect(formatDate("2027-01-14T12:00:00Z")).toBe("14 Jan 2027");
  });

  it("always uses three-letter months (no `Sept`)", () => {
    expect(formatDate(Date.UTC(2027, 8, 3) / DAY_MS)).toBe("3 Sep 2027");
    expect(formatShortDate(Date.UTC(2027, 8, 3) / DAY_MS)).toBe("3 Sep");
  });

  it("shows instants in Europe/Lisbon (summer time is UTC+1)", () => {
    // 23:30 UTC on 1 July is 00:30 on 2 July in Lisbon.
    expect(formatDate("2027-07-01T23:30:00Z")).toBe("2 Jul 2027");
    // In winter Lisbon is on UTC.
    expect(formatDate("2027-01-01T23:30:00Z")).toBe("1 Jan 2027");
  });

  it("keeps day numbers on their UTC calendar day", () => {
    expect(formatDate(Date.UTC(2027, 6, 2) / DAY_MS)).toBe("2 Jul 2027");
    expect(toIsoDate(Date.UTC(2027, 6, 2) / DAY_MS)).toBe("2027-07-02");
  });

  it("honours an explicit time zone", () => {
    expect(formatDate("2027-07-01T23:30:00Z", { timeZone: "UTC" })).toBe("1 Jul 2027");
  });
});

describe("times", () => {
  it("formats 24-hour Lisbon times", () => {
    expect(formatTime(JAN_14_2027_16H)).toBe("16:00");
    expect(formatTime("2027-07-01T14:05:09Z")).toBe("15:05");
    expect(formatTime("2027-07-01T14:05:09Z", { seconds: true })).toBe("15:05:09");
    expect(formatTime("2027-07-01T23:30:00Z")).toBe("00:30");
  });

  it("formats date and time together", () => {
    expect(formatDateTime(JAN_14_2027_16H)).toBe("14 Jan 2027, 16:00");
    expect(formatDateTime("2027-07-01T23:30:00Z")).toBe("2 Jul 2027, 00:30");
  });
});

describe("durations and relative days", () => {
  it("formats durations", () => {
    expect(formatDuration(90_061)).toBe("1 day 1 hour");
    expect(formatDuration(45 * 86_400 + 3 * 3600)).toBe("45 days 3 hours");
    expect(formatDuration(86_400 + 300)).toBe("1 day");
    expect(formatDuration(3 * 3600 + 20 * 60, { style: "short" })).toBe("3h 20m");
    expect(formatDuration(59)).toBe("59 sec");
    expect(formatDuration(0)).toBe("0 sec");
    expect(formatDuration(-120)).toBe("2 min");
    expect(formatDuration(45 * 86_400 + 3 * 3600 + 120, { maxUnits: 3, style: "short" })).toBe("45d 3h 2m");
  });

  it("counts calendar days and phrases them", () => {
    const now = JAN_14_2027_16H;
    expect(daysBetween(now, now + 3600 * 9)).toBe(1); // 16:00 → 01:00 next day
    expect(formatRelativeDays(JAN_14_2027_DAY, now)).toBe("today");
    expect(formatRelativeDays(JAN_14_2027_DAY + 1, now)).toBe("tomorrow");
    expect(formatRelativeDays(JAN_14_2027_DAY + 45, now)).toBe("in 45 days");
    expect(formatRelativeDays(JAN_14_2027_DAY - 1, now)).toBe("yesterday");
    expect(formatRelativeDays(JAN_14_2027_DAY - 3, now)).toBe("3 days ago");
  });
});
