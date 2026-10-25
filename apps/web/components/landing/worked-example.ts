// The worked example of spec §5.6, computed with the protocol formulas instead
// of typed in by hand, so the landing page cannot drift from the spec: the test
// next to this file pins every figure to the exact numbers in §5.6.

import { formatEur, formatPercent } from "@/lib/format";
import {
  BPS,
  DAY_SECS,
  PARAMS,
  STROOPS_PER_CENT,
  YEAR_SECS,
  centsToStroops,
  creditLimitCents,
  splitCommission,
  totalCommissionCents,
} from "@/lib/units";

const APR_BPS = BigInt(PARAMS.agentAprBps);
const FEE_BPS = BigInt(PARAMS.protocolFeeBps);
const SENIOR_TARGET_BPS = BigInt(PARAMS.seniorTargetBps);

const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;

/** One deal, start to finish (spec §5.6). Amounts in stroops. */
export interface DealExample {
  salePrice: bigint;
  rateBps: number;
  totalCommission: bigint;
  agentCommission: bigint;
  exploradorCommission: bigint;
  creditLimit: bigint;
  spent: bigint;
  days: number;
  interest: bigint;
  protocolFee: bigint;
  toTranches: bigint;
  debtRepaid: bigint;
  agentPayout: bigint;
  juniorDeposit: bigint;
}

/**
 * A sale at `rateBps`, `spentCents` drawn on day 0 and the escritura `days`
 * later with no other pool activity (a single accrual: simple interest at the
 * agent APR, rounded up like the contract's debt).
 */
export function dealExample(salePriceCents: bigint, rateBps: number, spentCents: bigint, days: number): DealExample {
  const totalCents = totalCommissionCents(salePriceCents, rateBps);
  const { agent, explorador } = splitCommission(totalCents);
  const spent = centsToStroops(spentCents);
  const interest = ceilDiv(spent * APR_BPS * BigInt(days * DAY_SECS), BPS * BigInt(YEAR_SECS));
  const protocolFee = (interest * FEE_BPS) / BPS;
  const debtRepaid = spent + interest;
  const agentCommission = centsToStroops(agent);
  return {
    salePrice: centsToStroops(salePriceCents),
    rateBps,
    totalCommission: centsToStroops(totalCents),
    agentCommission,
    exploradorCommission: centsToStroops(explorador),
    creditLimit: centsToStroops(creditLimitCents(agent)),
    spent,
    days,
    interest,
    protocolFee,
    toTranches: interest - protocolFee,
    debtRepaid,
    agentPayout: agentCommission - debtRepaid,
    juniorDeposit: centsToStroops(explorador),
  };
}

/** Projected yields for a pool (spec §5.5): net interest goes to senior up to the target, the rest to junior. */
export interface YieldScenario {
  debt: bigint;
  netInterestPerYear: bigint;
  seniorApy: number;
  juniorApy: number;
}

export function yieldScenario(seniorCents: bigint, juniorCents: bigint, debtCents: bigint): YieldScenario {
  const net = (debtCents * APR_BPS * (BPS - FEE_BPS)) / (BPS * BPS);
  const seniorDue = (seniorCents * SENIOR_TARGET_BPS) / BPS;
  const toSenior = net < seniorDue ? net : seniorDue;
  return {
    debt: centsToStroops(debtCents),
    netInterestPerYear: centsToStroops(net),
    seniorApy: Number(toSenior) / Number(seniorCents),
    juniorApy: Number(net - toSenior) / Number(juniorCents),
  };
}

/** A write-off (spec §4.6): the loss hits junior first, senior only once junior is exhausted. */
export function writeOffExample(seniorCents: bigint, juniorCents: bigint, lossCents: bigint) {
  const juniorLoss = lossCents < juniorCents ? lossCents : juniorCents;
  const seniorLoss = lossCents - juniorLoss;
  return {
    loss: centsToStroops(lossCents),
    juniorBefore: centsToStroops(juniorCents),
    juniorAfter: centsToStroops(juniorCents - juniorLoss),
    seniorBefore: centsToStroops(seniorCents),
    seniorAfter: centsToStroops(seniorCents - seniorLoss),
  };
}

/** Spec §5.6: €300,000 at 5%, €3,000 spent on day 0, escritura on day 90. */
export const DEAL = dealExample(30_000_000n, 500, 300_000n, 90);

/** Spec §5.6 yield illustration: senior €100,000, junior €10,000. */
export const POOL = { senior: centsToStroops(10_000_000n), junior: centsToStroops(1_000_000n) };
export const YIELD_LOW = yieldScenario(10_000_000n, 1_000_000n, 6_000_000n);
export const YIELD_HIGH = yieldScenario(10_000_000n, 1_000_000n, 9_000_000n);

/** Spec §5.6 loss illustration: €2,000 of carried debt written off. */
export const LOSS = writeOffExample(10_000_000n, 1_000_000n, 200_000n);

/** Whole euros when the amount has no cents ("€300,000"), otherwise "€88.77". */
export function eur(stroops: bigint): string {
  return formatEur(stroops, { decimals: stroops % (STROOPS_PER_CENT * 100n) === 0n ? 0 : 2 });
}

/** "6.48%", "8.00%" for senior; junior trims to one decimal ("17.2%", "0%"). */
export const seniorPct = (fraction: number) => formatPercent(fraction);
export const juniorPct = (fraction: number) => (fraction === 0 ? "0%" : formatPercent(fraction, { decimals: 1 }));
export const ratePct = (bps: number) => formatPercent(bps / 10_000, { decimals: 0 });
