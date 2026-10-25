// Commission split and credit limit of a CPCV (spec §1, §5.1, §5.6), shared by
// the New CPCV form's live preview and the server pipeline. Pure: safe in the
// browser.
//
//   total      = floor(sale price × rate / 10_000)            (circuit §8.3, cents)
//   agent      = floor(total / 2), explorador = total − agent  (spec §1)
//   credit     = agent commission × LTV, computed in stroops like
//                advance_pool.open_line (so it matches the line on-chain exactly)

import { BPS, centsToStroops, PARAMS, splitCommission, totalCommissionCents } from "@/lib/units";

export interface CommissionPreview {
  totalCents: bigint;
  agentCents: bigint;
  exploradorCents: bigint;
  /** Stroops, as stored on-chain. */
  total: bigint;
  agent: bigint;
  explorador: bigint;
  /** Stroops: `agent × ltv_bps / 10_000`, rounded down (advance_pool.open_line). */
  creditLimit: bigint;
}

/** Credit limit of a note from its agent commission in stroops (advance_pool.open_line). */
export const creditLimitOf = (agentCommission: bigint): bigint => (agentCommission * BigInt(PARAMS.ltvBps)) / BPS;

export function previewCommission(salePriceCents: bigint | number, commissionRateBps: number): CommissionPreview {
  const totalCents = totalCommissionCents(BigInt(salePriceCents), commissionRateBps);
  const { agent: agentCents, explorador: exploradorCents } = splitCommission(totalCents);
  const agent = centsToStroops(agentCents);
  return {
    totalCents,
    agentCents,
    exploradorCents,
    total: centsToStroops(totalCents),
    agent,
    explorador: centsToStroops(exploradorCents),
    creditLimit: creditLimitOf(agent),
  };
}

export interface SettlementPreview {
  /** Line debt repaid from the agent's half (principal + interest). */
  debtRepaid: bigint;
  /** Carried debt of other (cancelled) notes repaid from this commission. */
  carriedRepaid: bigint;
  /** Credited to the agent's card balance. */
  agentPayout: bigint;
  /** Line debt above the agent's half: becomes carried debt. */
  shortfall: bigint;
  /** explorador's half, added to the junior (first-loss) tranche. */
  juniorDeposit: bigint;
}

/**
 * What `advance_pool.settle` will do with a note's commission (spec §4.5,
 * §7.3), in stroops: repay the line, then the agent's carried debt, credit the
 * rest of the agent's half to the card balance; explorador's half goes to junior.
 */
export function previewSettlement(input: {
  agentCommission: bigint;
  exploradorCommission: bigint;
  lineDebt: bigint;
  carriedDebt: bigint;
}): SettlementPreview {
  const { agentCommission, exploradorCommission, lineDebt, carriedDebt } = input;
  const debtRepaid = lineDebt < agentCommission ? lineDebt : agentCommission;
  const shortfall = lineDebt > agentCommission ? lineDebt - agentCommission : 0n;
  const left = agentCommission > lineDebt ? agentCommission - lineDebt : 0n;
  const carriedRepaid = carriedDebt < left ? carriedDebt : left;
  return { debtRepaid, carriedRepaid, agentPayout: left - carriedRepaid, shortfall, juniorDeposit: exploradorCommission };
}
