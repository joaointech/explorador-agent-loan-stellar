import { describe, expect, it } from "vitest";

import { poolStatsResponse } from "./__tests__/fixtures";
import { poolStatValues } from "./pool-stat-values";

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
});
