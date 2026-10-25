// Landing hero stat pills (spec §10.2): GET /api/pool/stats → display strings.
// Pure, so it is tested without a browser.

import { formatEur, formatNumber, formatPercent, roundDiv } from "@/lib/format";
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

/**
 * Whole euros ("€110,000"); from a million up, millions with one decimal
 * ("€1.2m", "€12m") so the pill never truncates on a phone. Built by hand:
 * Intl's compact notation differs between ICU versions ("€12m" vs "€12.0M").
 */
export function euros(stroops: bigint): string {
  const whole = roundDiv(stroops, STROOPS_PER_EUR);
  if (whole < 1_000_000n) return formatEur(stroops, { decimals: 0 });
  const tenths = roundDiv(whole, 100_000n);
  return `€${formatNumber(tenths / 10n)}${tenths % 10n === 0n ? "" : `.${tenths % 10n}`}m`;
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
