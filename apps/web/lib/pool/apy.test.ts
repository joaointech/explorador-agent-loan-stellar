import { describe, expect, it } from "vitest";

import { PARAMS, SCALE, STROOPS_PER_EUR, YEAR_SECS } from "@/lib/units";

import { MIN_TRAILING_SECS, projectedApy, sharePriceNumber, trailingApy } from "./apy";
import { demoClock, isOverdue, protocolDay } from "./clock";

const eur = (n: number) => BigInt(n) * STROOPS_PER_EUR;
const params = { agentAprBps: PARAMS.agentAprBps, protocolFeeBps: PARAMS.protocolFeeBps, seniorTargetBps: PARAMS.seniorTargetBps };

describe("projectedApy (spec §5.6 yield illustration: senior €100,000, junior €10,000)", () => {
  it("debt €60,000 → net €6,480/yr, senior 6.48%, junior 0%", () => {
    const apy = projectedApy({ totalDebt: eur(60_000), seniorAssets: eur(100_000), juniorAssets: eur(10_000), params });
    expect(apy.netInterestPerYear).toBe(eur(6_480));
    expect(apy.senior).toBeCloseTo(0.0648, 10);
    expect(apy.junior).toBe(0);
  });

  it("debt €90,000 → net €9,720/yr, senior 8.00%, junior €1,720 on €10,000 = 17.2%", () => {
    const apy = projectedApy({ totalDebt: eur(90_000), seniorAssets: eur(100_000), juniorAssets: eur(10_000), params });
    expect(apy.netInterestPerYear).toBe(eur(9_720));
    expect(apy.senior).toBeCloseTo(0.08, 10);
    expect(apy.junior).toBeCloseTo(0.172, 10);
  });

  it("handles an empty pool and missing tranches without dividing by zero", () => {
    expect(projectedApy({ totalDebt: 0n, seniorAssets: 0n, juniorAssets: 0n, params })).toEqual({ senior: 0, junior: 0, netInterestPerYear: 0n });
    const noSenior = projectedApy({ totalDebt: eur(10_000), seniorAssets: 0n, juniorAssets: eur(10_000), params });
    expect(noSenior.senior).toBeCloseTo(0.08, 10);
    expect(noSenior.junior).toBeCloseTo(0.108, 10);
  });
});

describe("trailingApy", () => {
  const DAY = 86_400;
  const at = (days: number, price: number) => ({ t: 1_790_000_000 + days * DAY, priceScaled: BigInt(Math.round(price * 1e9)) * 10n ** 9n });

  it("annualizes share-price growth over the 7-day window: (p_now/p_then)^(YEAR/Δt) − 1", () => {
    const p7 = (1.08) ** (7 * DAY / YEAR_SECS); // price after 7 days at 8% effective APY
    const apy = trailingApy(at(7, p7), [at(0, 1), at(3, 1.0005)]);
    expect(apy).not.toBeNull();
    expect(apy!).toBeCloseTo(0.08, 6);
  });

  it("uses the newest snapshot that is at least 7 days old (fast-forwarded clock)", () => {
    // +30 days in one jump: day 0 and day 30 snapshots
    const p30 = (1.08) ** (30 * DAY / YEAR_SECS);
    expect(trailingApy(at(30, p30), [at(0, 1), at(30, p30)])!).toBeCloseTo(0.08, 6);
    // with a day-20 snapshot, the window is day 20 → day 30
    const p20 = (1.06) ** (20 * DAY / YEAR_SECS);
    const p30b = p20 * (1.10) ** (10 * DAY / YEAR_SECS);
    expect(trailingApy(at(30, p30b), [at(0, 1), at(20, p20), at(25, 1.01)])!).toBeCloseTo(0.10, 6);
  });

  it("falls back to the oldest snapshot ≥ 1 day old, else null", () => {
    expect(trailingApy(at(0.5, 1.0001), [at(0, 1)])).toBeNull();
    expect(trailingApy(at(2, 1.0004), [at(0, 1)])).not.toBeNull();
    expect(trailingApy(at(1, 1), [])).toBeNull();
    expect(MIN_TRAILING_SECS).toBe(DAY);
  });

  it("shows losses as negative yield", () => {
    expect(trailingApy(at(7, 0.99), [at(0, 1)])!).toBeLessThan(0);
  });
});

describe("helpers", () => {
  it("sharePriceNumber keeps 9 decimals", () => {
    expect(sharePriceNumber(1_052_631_578_947_368_421n)).toBe(1.052631578);
    expect(sharePriceNumber(SCALE)).toBe(1);
  });

  it("demoClock estimates the offset from protocol time vs wall clock", () => {
    const nowMs = 1_792_000_000_000;
    const params = { ...PARAMS, gracePeriodSecs: 0n, demoMode: true };
    expect(demoClock({ protocolNow: 1_791_999_995n, params }, nowMs)).toEqual({ protocolNow: 1_791_999_995, offsetSecs: 0, demoMode: true });
    expect(demoClock({ protocolNow: BigInt(1_792_000_000 + 81 * 86_400 - 4), params }, nowMs).offsetSecs).toBe(81 * 86_400);
  });

  it("protocolDay / isOverdue", () => {
    expect(protocolDay(20_500 * 86_400 + 5)).toBe(20_500);
    expect(isOverdue("Active", 20_499, 20_500 * 86_400)).toBe(true);
    expect(isOverdue("Active", 20_500, 20_500 * 86_400)).toBe(false);
    expect(isOverdue("Settled", 20_000, 20_500 * 86_400)).toBe(false);
  });
});
