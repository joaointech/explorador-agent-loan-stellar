// Interest display math and yield projections against the worked example (§5.5, §5.6).
import { describe, expect, it } from "vitest";
import { eurToStroops, formatStroops, stroopsToEur, tickDebt } from "@/lib/format";
import { projectedApy } from "@/lib/pool";
import type { PoolStatsDto } from "@/lib/api-types";

const DAY = 86_400;

describe("tickDebt (live interest display)", () => {
  it("€3,000 at 12% for 90 days → €3,088.77 (single accrual)", () => {
    const debt = tickDebt(eurToStroops(3000), 1200, 90 * DAY);
    expect(Math.round(stroopsToEur(debt) * 100) / 100).toBe(3088.77);
    expect(stroopsToEur(debt - eurToStroops(3000))).toBeCloseTo(88.767, 3);
    // Balances are displayed rounded down to the cent.
    expect(formatStroops(44_112_390_000n)).toBe("€4,411.23"); // €4,411.239
  });

  it("€4,411.23 lands on the card balance at settlement", () => {
    const debt = tickDebt(eurToStroops(3000), 1200, 90 * DAY);
    const payout = eurToStroops(7500) - debt;
    expect(stroopsToEur(payout)).toBeCloseTo(4411.23, 2);
  });

  it("does not tick for zero debt or non-positive elapsed time", () => {
    expect(tickDebt(0n, 1200, 1000)).toBe(0n);
    expect(tickDebt(100n, 1200, -5)).toBe(100n);
  });
});

function stats(seniorEur: number, juniorEur: number, debtEur: number): PoolStatsDto {
  const s = (e: number) => eurToStroops(e).toString();
  return {
    seniorAssets: s(seniorEur),
    juniorAssets: s(juniorEur),
    feesAccrued: "0",
    totalDebt: s(debtEur),
    totalPrincipal: s(debtEur),
    poolCash: "0",
    totalCardBalances: "0",
    shareSupply: "0",
    sharePriceScaled: (10n ** 18n).toString(),
    sharePrice: 1,
    utilizationBps: 0,
    leverageX100: 0,
    lendable: "0",
    leverageHeadroom: "0",
    borrowIndex: (10n ** 18n).toString(),
    protocolNow: 0,
    params: { agentAprBps: 1200, protocolFeeBps: 1000, seniorTargetBps: 800, ltvBps: 5000, gracePeriodSecs: 180 * DAY, maxLeverage: 10, demoMode: true },
    writtenOffTotal: "0",
  };
}

describe("projected APY", () => {
  it("€60k debt → senior 6.48%, junior 0%", () => {
    const y = projectedApy(stats(100_000, 10_000, 60_000));
    expect(y.projectedSenior).toBeCloseTo(0.0648, 6);
    expect(y.projectedJunior).toBeCloseTo(0, 6);
  });

  it("€90k debt → senior 8.00%, junior 17.2%", () => {
    const y = projectedApy(stats(100_000, 10_000, 90_000));
    expect(y.projectedSenior).toBeCloseTo(0.08, 6);
    expect(y.projectedJunior).toBeCloseTo(0.172, 6);
  });
});
