import { describe, expect, it } from "vitest";

import { DAY_SECS } from "@/lib/units";

import { priceDecimals, timeFormatter } from "./pool-charts";

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
