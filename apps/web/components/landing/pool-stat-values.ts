// Landing hero stat pills (spec §10.2): GET /api/pool/stats → display strings.
// Pure, so it is tested without a browser.

import { formatEur, formatNumber, formatPercent } from "@/lib/format";
import type { PoolStatsResponse } from "@/lib/types/api";
import { STROOPS_PER_EUR } from "@/lib/units";

export interface PoolStatValues {
  /** Senior + junior assets. */
  tvl: string;
  /** Projected senior APY (spec §5.5). */
  seniorApy: string;
  /** The senior target, for the hint ("target 8%"). */
  seniorTarget: string;
  activeNotes: string;
  /** Cumulative card spending funded by credit. */
  totalAdvanced: string;
}

/** Whole euros; compact ("€1.2m") from a million up so the pill never truncates on a phone. */
function euros(stroops: bigint): string {
  return stroops >= 1_000_000n * STROOPS_PER_EUR ? formatEur(stroops, { compact: true }) : formatEur(stroops, { decimals: 0 });
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Throws on a malformed body, so the pills show the error state rather than garbage. */
export function poolStatValues(body: PoolStatsResponse): PoolStatValues {
  const { stats, apy, notes, totalAdvanced } = body ?? {};
  if (!stats || !apy || !notes) throw new Error("Unexpected pool stats response");
  if (!isFiniteNumber(apy.projectedSenior) || !isFiniteNumber(apy.target) || !isFiniteNumber(notes.Active)) {
    throw new Error("Unexpected pool stats response");
  }
  const tvl = BigInt(stats.seniorAssets) + BigInt(stats.juniorAssets);
  const target = formatPercent(apy.target);
  return {
    tvl: euros(tvl),
    seniorApy: formatPercent(apy.projectedSenior),
    seniorTarget: target.endsWith(".00%") ? formatPercent(apy.target, { decimals: 0 }) : target,
    activeNotes: formatNumber(notes.Active),
    totalAdvanced: euros(BigInt(totalAdvanced)),
  };
}
