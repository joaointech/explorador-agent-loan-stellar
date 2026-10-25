import { describe, expect, it } from "vitest";

import { EMPTY_VALUE, formatBps, formatMultiplier, formatNumber, formatPercent } from "./number";

describe("formatPercent", () => {
  it("formats fractions with two decimals", () => {
    expect(formatPercent(0.0648)).toBe("6.48%");
    expect(formatPercent(0.08)).toBe("8.00%");
    expect(formatPercent(0.172, { decimals: 1 })).toBe("17.2%");
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("adds a sign for deltas", () => {
    expect(formatPercent(0.0123, { signed: true })).toBe("+1.23%");
    expect(formatPercent(-0.0123, { signed: true })).toBe("-1.23%");
  });

  it("shows a dash for missing values", () => {
    expect(formatPercent(null)).toBe(EMPTY_VALUE);
    expect(formatPercent(undefined)).toBe(EMPTY_VALUE);
    expect(formatPercent(Number.NaN)).toBe(EMPTY_VALUE);
  });
});

describe("formatBps", () => {
  it("trims trailing zeros", () => {
    expect(formatBps(1200)).toBe("12%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(875)).toBe("8.75%");
    expect(formatBps(5000n)).toBe("50%");
    expect(formatBps(1)).toBe("0.01%");
  });
});

describe("numbers", () => {
  it("groups thousands", () => {
    expect(formatNumber(375420)).toBe("375,420");
    expect(formatNumber(12_345_678_901_234_567_890n)).toBe("12,345,678,901,234,567,890");
  });

  it("formats the leverage multiplier", () => {
    expect(formatMultiplier(245)).toBe("2.45×");
    expect(formatMultiplier(1000, 1)).toBe("10.0×");
  });
});
