// Test-only pool fixture: GET /api/pool/stats for the spec §5.6 pool.

import type { PoolStatsResponse } from "@/lib/types/api";

const DAY = 86_400;

/** GET /api/pool/stats with the spec §5.6 pool (senior €100,000, junior €10,000, €60,000 lent). */
export function poolStatsResponse(): PoolStatsResponse {
  const eur = (n: number) => (BigInt(n) * 10_000_000n).toString();
  return {
    stats: {
      seniorAssets: eur(100_000),
      juniorAssets: eur(10_000),
      feesAccrued: eur(120),
      totalDebt: eur(60_000),
      totalPrincipal: eur(59_000),
      poolCash: eur(50_120),
      totalCardBalances: eur(0),
      shareSupply: eur(98_000),
      sharePriceScaled: "1020408163265306122",
      utilizationBps: 5455,
      leverageX100: 600,
      lendable: eur(50_000),
      leverageHeadroom: eur(40_000),
      borrowIndex: "1010000000000000000",
      protocolNow: "1799942400",
      params: {
        agentAprBps: 1200,
        protocolFeeBps: 1000,
        seniorTargetBps: 800,
        ltvBps: 5000,
        gracePeriodSecs: String(180 * DAY),
        maxLeverage: 10,
        demoMode: true,
      },
      writtenOffTotal: eur(0),
    },
    apy: { target: 0.08, projectedSenior: 0.0648, projectedJunior: 0, trailing7dSenior: null },
    notes: { Active: 3, Settled: 1, Cancelled: 1, WrittenOff: 0, total: 5 },
    totalAdvanced: eur(98_124),
    clock: { protocolNow: 1_799_942_400, offsetSecs: 0, demoMode: true },
  };
}
