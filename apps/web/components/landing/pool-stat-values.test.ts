import { describe, expect, it } from "vitest";

import { poolStatsResponse } from "./__tests__/fixtures";
import { euros, poolStatValues } from "./pool-stat-values";

describe("landing pool stat pills", () => {
  it("formats TVL, projected senior APY, active notes and total advanced", () => {
    expect(poolStatValues(poolStatsResponse())).toEqual({
      tvl: "€110,000",
      seniorApy: "6.48%",
      seniorTarget: "8%",
      activeNotes: "3",
      totalAdvanced: "€98,124",
    });
  });

  it("goes compact for very large pools and rejects malformed bodies", () => {
    const big = poolStatsResponse();
    big.stats.seniorAssets = (12_000_000n * 10_000_000n).toString();
    expect(poolStatValues(big).tvl).toBe("€12m");
    big.stats.seniorAssets = (1_240_000n * 10_000_000n).toString();
    big.stats.juniorAssets = "0";
    expect(poolStatValues(big).tvl).toBe("€1.2m");
    big.stats.seniorAssets = (999_999n * 10_000_000n).toString();
    expect(poolStatValues(big).tvl).toBe("€999,999");
    expect(() => poolStatValues({} as never)).toThrow();
    expect(() => poolStatValues({ ...poolStatsResponse(), apy: { ...poolStatsResponse().apy, projectedSenior: Number.NaN } })).toThrow();
  });

  it("formats millions by hand, independent of the ICU version", () => {
    const eur = (n: number) => BigInt(Math.round(n * 1e7));
    expect(euros(eur(1_000_000))).toBe("€1m");
    expect(euros(eur(1_050_000))).toBe("€1.1m");
    expect(euros(eur(1_249_999))).toBe("€1.2m");
    expect(euros(eur(25_960_000))).toBe("€26m");
    expect(euros(eur(1_234_500_000))).toBe("€1,234.5m");
    expect(euros(eur(999_999.4))).toBe("€999,999");
    expect(euros(eur(999_999.6))).toBe("€1m");
    expect(euros(0n)).toBe("€0");
  });
});
