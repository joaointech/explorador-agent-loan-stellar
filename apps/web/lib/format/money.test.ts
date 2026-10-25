import { describe, expect, it } from "vitest";

import {
  formatCents,
  formatEur,
  formatSharePrice,
  formatToken,
  parseEurToCents,
  roundDiv,
  toBigIntAmount,
  toCents,
} from "./money";

// Worked example (spec §5.6): credit limit €3,750; debt €3,088.7671…; payout €4,411.23.
const CREDIT_LIMIT_STROOPS = 37_500_000_000n;
const DEBT_STROOPS = 30_887_671_233n; // €3,088.7671233 (the contract rounds debts up)
const PAYOUT_STROOPS = 44_112_328_767n; // €4,411.2328767

describe("formatEur", () => {
  it("formats stroops (bigint, string, number) as en-GB euros", () => {
    expect(formatEur(CREDIT_LIMIT_STROOPS)).toBe("€3,750.00");
    expect(formatEur("37500000000")).toBe("€3,750.00");
    expect(formatEur(37_500_000_000)).toBe("€3,750.00");
  });

  it("rounds stroops to the nearest cent, half away from zero", () => {
    expect(formatEur(DEBT_STROOPS)).toBe("€3,088.77");
    expect(formatEur(PAYOUT_STROOPS)).toBe("€4,411.23");
    expect(formatEur(50_000n)).toBe("€0.01"); // exactly half a cent rounds up
    expect(formatEur(49_999n)).toBe("€0.00");
    expect(formatEur(-50_000n)).toBe("-€0.01");
  });

  it("formats cents and whole euros", () => {
    expect(formatEur(375_000, { unit: "cents" })).toBe("€3,750.00");
    expect(formatCents(1_500_000n)).toBe("€15,000.00");
    expect(formatEur(4.8, { unit: "eur" })).toBe("€4.80");
    expect(formatEur("349", { unit: "eur" })).toBe("€349.00");
    expect(formatEur("62.005", { unit: "eur" })).toBe("€62.01");
  });

  it("handles zero, negatives and signs", () => {
    expect(formatEur(0n)).toBe("€0.00");
    expect(formatEur(-CREDIT_LIMIT_STROOPS)).toBe("-€3,750.00");
    expect(formatEur(PAYOUT_STROOPS, { sign: "always" })).toBe("+€4,411.23");
    expect(formatEur(0n, { sign: "exceptZero" })).toBe("€0.00");
  });

  it("keeps full precision for very large amounts", () => {
    // €900 trillion: far past Number.MAX_SAFE_INTEGER stroops.
    expect(formatEur(9_000_000_000_000_000_000_000n)).toBe("€900,000,000,000,000.00");
  });

  it("supports whole-euro and compact output", () => {
    expect(formatEur(DEBT_STROOPS, { decimals: 0 })).toBe("€3,089");
    expect(formatEur(650_000_000_000n, { compact: true })).toBe("€65k");
    expect(formatEur(12_500_000_000_000n, { compact: true })).toBe("€1.3m");
  });

  it("rejects fractional or malformed integer amounts", () => {
    expect(() => formatEur("12.5")).toThrow(RangeError);
    expect(() => formatEur(1.5)).toThrow(RangeError);
    expect(() => formatEur("abc")).toThrow(RangeError);
  });
});

describe("amount helpers", () => {
  it("roundDiv rounds half away from zero", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(roundDiv(-4n, 3n)).toBe(-1n);
  });

  it("toBigIntAmount accepts integer strings with a sign", () => {
    expect(toBigIntAmount(" -42 ")).toBe(-42n);
    expect(toBigIntAmount("+7")).toBe(7n);
  });

  it("toCents converts every unit", () => {
    expect(toCents(CREDIT_LIMIT_STROOPS)).toBe(375_000n);
    expect(toCents(99, "cents")).toBe(99n);
    expect(toCents(3n, "eur")).toBe(300n);
  });

  it("parseEurToCents reads what people type", () => {
    expect(parseEurToCents("62")).toBe(6200n);
    expect(parseEurToCents("62.5")).toBe(6250n);
    expect(parseEurToCents("€1,234.56")).toBe(123_456n);
    expect(parseEurToCents(".5")).toBe(50n);
    expect(parseEurToCents("-3.999")).toBe(-400n);
    expect(parseEurToCents("")).toBeNull();
    expect(parseEurToCents("1.2.3")).toBeNull();
    expect(parseEurToCents("abc")).toBeNull();
  });
});

describe("token amounts", () => {
  it("formats eaSR shares with 7 decimals", () => {
    expect(formatToken("400000000000", { symbol: "eaSR" })).toBe("40,000.00 eaSR");
    expect(formatToken(12_345_678n)).toBe("1.2346");
    expect(formatToken(12_345_678n, { maximumFractionDigits: 7 })).toBe("1.2345678");
  });

  it("formats the scaled share price", () => {
    expect(formatSharePrice(10n ** 18n)).toBe("€1.0000");
    expect(formatSharePrice("1012345678901234567")).toBe("€1.0123");
    expect(formatSharePrice("1012345678901234567", 6)).toBe("€1.012346");
  });
});
