// Displayed yields (spec §5.5), computed in the app from pool stats and
// share-price snapshots. Fractions: 0.08 = 8%.

import type { PoolParams } from "@/lib/types/chain";
import { BPS, DAY_SECS, SCALE, YEAR_SECS } from "@/lib/units";

/** 1e12 fixed point for bigint → fraction conversion. */
const RATIO_SCALE = 10n ** 12n;
const ratio = (num: bigint, den: bigint): number => (den === 0n ? 0 : Number((num * RATIO_SCALE) / den) / 1e12);

export interface ApyInput {
  totalDebt: bigint;
  seniorAssets: bigint;
  juniorAssets: bigint;
  params: Pick<PoolParams, "agentAprBps" | "protocolFeeBps" | "seniorTargetBps">;
}

export interface ProjectedApy {
  /** min(target, net interest per year / senior assets). */
  senior: number;
  /** (net interest per year − senior's share) / junior assets. */
  junior: number;
  /** total_debt × apr × (1 − fee), stroops per year. */
  netInterestPerYear: bigint;
}

/**
 * Projected APY: `net = total_debt × apr × (1 − fee)`, senior gets interest
 * first up to the target, junior the remainder. With no senior capital the
 * senior figure is the target (what a first depositor would earn).
 */
export function projectedApy({ totalDebt, seniorAssets, juniorAssets, params }: ApyInput): ProjectedApy {
  const net = (totalDebt * BigInt(params.agentAprBps) * (BPS - BigInt(params.protocolFeeBps))) / (BPS * BPS);
  const seniorCap = (seniorAssets * BigInt(params.seniorTargetBps)) / BPS;
  const seniorTake = net < seniorCap ? net : seniorCap;
  const senior = seniorAssets > 0n ? ratio(seniorTake, seniorAssets) : net > 0n ? params.seniorTargetBps / 10_000 : 0;
  return { senior, junior: ratio(net - seniorTake, juniorAssets), netInterestPerYear: net };
}

export interface SharePricePoint {
  /** Protocol clock, unix seconds. */
  t: number;
  /** Assets per share × 1e18. */
  priceScaled: bigint;
}

export const TRAILING_WINDOW_SECS = 7 * DAY_SECS;
/** Shortest window we annualize when less than 7 days of history exist. */
export const MIN_TRAILING_SECS = DAY_SECS;

/**
 * Trailing senior APY over 7 protocol days: `(p_now / p_then)^(YEAR/Δt) − 1`,
 * with `then` = the newest snapshot at least 7 days old. With less history it
 * annualizes over the oldest snapshot at least a day old; otherwise null.
 */
export function trailingApy(now: SharePricePoint, history: SharePricePoint[], windowSecs = TRAILING_WINDOW_SECS): number | null {
  const past = history.filter((p) => p.t < now.t && p.priceScaled > 0n).sort((a, b) => a.t - b.t);
  if (past.length === 0 || now.priceScaled <= 0n) return null;
  const cutoff = now.t - windowSecs;
  let then: SharePricePoint | undefined;
  for (const p of past) if (p.t <= cutoff) then = p;
  if (!then && now.t - past[0].t >= MIN_TRAILING_SECS) then = past[0];
  if (!then) return null;
  const growth = Number((now.priceScaled * SCALE) / then.priceScaled) / 1e18;
  return growth ** (YEAR_SECS / (now.t - then.t)) - 1;
}

/** Share price as a display number (assets per share, 9 decimals). */
export const sharePriceNumber = (priceScaled: bigint): number => Number((priceScaled * 1_000_000_000n) / SCALE) / 1e9;
