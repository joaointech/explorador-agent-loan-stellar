// The tranche waterfall of spec §5.5 / §5.6 as plain numbers, for the "How
// your yield works" explainer: interest → protocol fee → senior (up to the
// target APY) → junior; losses hit junior first, then senior.

import { projectedApy } from "@/lib/pool/apy";
import type { PoolParams } from "@/lib/types/chain";
import { BPS, PARAMS, STROOPS_PER_EUR } from "@/lib/units";

export type YieldParams = Pick<PoolParams, "agentAprBps" | "protocolFeeBps" | "seniorTargetBps">;

export const DEFAULT_YIELD_PARAMS: YieldParams = {
  agentAprBps: PARAMS.agentAprBps,
  protocolFeeBps: PARAMS.protocolFeeBps,
  seniorTargetBps: PARAMS.seniorTargetBps,
};

export interface YieldScenario {
  /** Outstanding agent debt, stroops. */
  debt: bigint;
  seniorAssets: bigint;
  juniorAssets: bigint;
  /** Interest agents pay per year at the APR, stroops. */
  grossInterest: bigint;
  /** Protocol fee per year (to explorador). */
  fee: bigint;
  /** grossInterest − fee. */
  netInterest: bigint;
  /** Senior's share per year: min(net, target × senior assets). */
  toSenior: bigint;
  /** Junior's share per year: the remainder. */
  toJunior: bigint;
  /** Fractions: 0.08 = 8%. */
  seniorApy: number;
  juniorApy: number;
}

/** One year of interest on `debt`, split across the tranches. */
export function yieldScenario(
  input: { debt: bigint; seniorAssets: bigint; juniorAssets: bigint },
  params: YieldParams = DEFAULT_YIELD_PARAMS,
): YieldScenario {
  const grossInterest = (input.debt * BigInt(params.agentAprBps)) / BPS;
  const fee = (grossInterest * BigInt(params.protocolFeeBps)) / BPS;
  const netInterest = grossInterest - fee;
  const seniorCap = (input.seniorAssets * BigInt(params.seniorTargetBps)) / BPS;
  const toSenior = netInterest < seniorCap ? netInterest : seniorCap;
  const apy = projectedApy({ totalDebt: input.debt, seniorAssets: input.seniorAssets, juniorAssets: input.juniorAssets, params });
  return {
    ...input,
    grossInterest,
    fee,
    netInterest,
    toSenior,
    toJunior: netInterest - toSenior,
    seniorApy: apy.senior,
    juniorApy: apy.junior,
  };
}

/** A write-off of `loss`: junior absorbs it first, senior only what junior can't cover. */
export function applyLoss(seniorAssets: bigint, juniorAssets: bigint, loss: bigint): { seniorAssets: bigint; juniorAssets: bigint; seniorLoss: bigint; juniorLoss: bigint } {
  const juniorLoss = loss < juniorAssets ? loss : juniorAssets;
  const seniorLoss = loss - juniorLoss;
  return { seniorAssets: seniorAssets - seniorLoss, juniorAssets: juniorAssets - juniorLoss, seniorLoss, juniorLoss };
}

const eur = (n: number) => BigInt(n) * STROOPS_PER_EUR;

/** Spec §5.6 yield illustration: senior €100,000, junior €10,000. */
export const ILLUSTRATION = {
  seniorAssets: eur(100_000),
  juniorAssets: eur(10_000),
  debts: [eur(60_000), eur(90_000)],
  /** Loss illustration: a €2,000 carried debt written off. */
  loss: eur(2_000),
} as const;
