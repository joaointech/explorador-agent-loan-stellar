import { describe, expect, it } from "vitest";

import { DAY_SECS } from "@/lib/units";

import { timeTicks } from "@/components/ui/charts";

import { priceDecimals, spanLabel, timeFormatter } from "./pool-charts";

const T0 = Date.UTC(2027, 0, 14, 16, 0) / 1000;

describe("priceDecimals", () => {
  it("uses 4 decimals for a visible month of growth", () => {
    expect(priceDecimals([{ sharePrice: 1.0412 }, { sharePrice: 1.048 }])).toBe(4);
  });

  it("adds decimals until neighbouring ticks differ", () => {
    expect(priceDecimals([{ sharePrice: 1.0000001 }, { sharePrice: 1.0000003 }])).toBe(8);
    expect(priceDecimals([{ sharePrice: 1.00001 }, { sharePrice: 1.00005 }])).toBe(6);
  });

  it("falls back to 4 without a spread", () => {
    expect(priceDecimals([{ sharePrice: 1 }])).toBe(4);
    expect(priceDecimals([{ sharePrice: 1 }, { sharePrice: 1 }])).toBe(4);
  });
});

describe("timeFormatter", () => {
  it("shows times (Lisbon) when the history fits in a day", () => {
    const fmt = timeFormatter([{ t: T0 }, { t: T0 + 3_600 }]);
    expect(fmt(T0)).toBe("16:00");
  });

  it("shows dates for longer histories", () => {
    const fmt = timeFormatter([{ t: T0 - 7 * DAY_SECS }, { t: T0 }]);
    expect(fmt(T0)).toBe("14 Jan");
  });
});

describe("spanLabel", () => {
  it("names the day and both times within a day", () => {
    expect(spanLabel([{ t: T0 }, { t: T0 + 3_600 }])).toBe("14 Jan 2027, 16:00 – 17:00");
  });

  it("puts the year at the end within a year", () => {
    expect(spanLabel([{ t: T0 - 7 * DAY_SECS }, { t: T0 }])).toBe("7 Jan – 14 Jan 2027");
  });

  it("gives both years across a new year, so the range never reads backwards", () => {
    // The seeded demo history: 25 Oct 2026 → 22 Feb 2027 used to read "25 Oct – 22 Feb".
    expect(spanLabel([{ t: Date.UTC(2026, 9, 25, 17, 30) / 1000 }, { t: Date.UTC(2027, 1, 22, 17, 30) / 1000 }])).toBe("25 Oct 2026 – 22 Feb 2027");
  });
});

describe("timeTicks", () => {
  const fmt = timeFormatter([{ t: T0 - 120 * DAY_SECS }, { t: T0 }]);

  it("spreads ticks evenly in time", () => {
    expect(timeTicks([T0 - 120 * DAY_SECS, T0 - 119 * DAY_SECS, T0], fmt)).toEqual([0, 30, 60, 90, 120].map((d) => T0 - (120 - d) * DAY_SECS));
  });

  it("never repeats a label", () => {
    // Two days of history labelled by date: five ticks would read 14 Jan, 15 Jan, 15 Jan, 16 Jan, 16 Jan.
    const dates = timeFormatter([{ t: T0 }, { t: T0 + 2 * DAY_SECS }]);
    const labels = timeTicks([T0, T0 + 2 * DAY_SECS], dates).map(dates);
    expect(labels).toEqual([...new Set(labels)]);
    expect(labels).toEqual(["14 Jan", "15 Jan", "16 Jan"]);
  });

  it("handles one point and no points", () => {
    expect(timeTicks([T0], fmt)).toEqual([T0]);
    expect(timeTicks([], fmt)).toEqual([]);
  });
});
