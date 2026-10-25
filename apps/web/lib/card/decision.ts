// Pure ASA decision logic (spec §4.4 step 3, §9.5). No I/O: the handler
// gathers the inputs (agent row, on-chain position, pool stats, pending
// holds) and this module decides. All amounts are bigint stroops unless the
// name says cents; card amounts are cents treated as EUR 1:1.

import type { AsaResult } from "@/lib/lithic/asa";
import { STROOPS_PER_CENT } from "@/lib/units";

export type AuthKind = "purchase" | "balance_inquiry" | "other";

/** AUTHORIZATION / FINANCIAL_AUTHORIZATION spend; BALANCE_INQUIRY asks; everything else (credits, …) is recorded only. */
export function classifyStatus(status: string): AuthKind {
  if (status === "AUTHORIZATION" || status === "FINANCIAL_AUTHORIZATION") return "purchase";
  if (status === "BALANCE_INQUIRY") return "balance_inquiry";
  return "other";
}

/** The parts of `advance_pool.agent_position` the decision needs. */
export interface PositionSnapshot {
  cardBalance: bigint;
  cardEnabled: boolean;
  availableCredit: bigint;
  /** min(available_credit, lendable, leverage_headroom) as computed on-chain; null if unknown. */
  borrowableNow: bigint | null;
  /** "chain": live RPC read; "cache": Agent.cachedPosition fallback. */
  source: "chain" | "cache";
  /** When the cached read started (source "cache"); null for live reads. */
  cachedAt: Date | null;
}

/** The parts of `advance_pool.stats` the decision needs. */
export interface StatsSnapshot {
  lendable: bigint;
  leverageHeadroom: bigint;
}

export interface HoldCandidate {
  decision: "APPROVED" | "DECLINED";
  chainStatus: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  amountCents: bigint;
  createdAt: Date;
}

/**
 * Whether an authorization still has to be subtracted from the position.
 * Spec: approved and not yet confirmed on-chain (PENDING/SUBMITTED). When the
 * position comes from the cache, draws confirmed after the cached read are not
 * in it either, so they count too. FAILED draws never moved funds; credits and
 * zero-amount authorizations never draw.
 */
export function isPendingHold(row: HoldCandidate, position: Pick<PositionSnapshot, "source" | "cachedAt">): boolean {
  if (row.decision !== "APPROVED" || row.amountCents <= 0n) return false;
  if (row.chainStatus === "PENDING" || row.chainStatus === "SUBMITTED") return true;
  return (
    row.chainStatus === "CONFIRMED" &&
    position.source === "cache" &&
    position.cachedAt !== null &&
    row.createdAt > position.cachedAt
  );
}

/** Σ pending holds, in stroops. */
export function sumPendingHolds(rows: HoldCandidate[], position: Pick<PositionSnapshot, "source" | "cachedAt">): bigint {
  return rows.filter((r) => isPendingHold(r, position)).reduce((sum, r) => sum + r.amountCents, 0n) * STROOPS_PER_CENT;
}

const min = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));

/**
 * spendable = card_balance + min(available_credit, lendable, leverage_headroom) − pending_holds.
 * Without live stats the position's own `borrowable_now` (the same min, computed on-chain)
 * bounds the credit. Can be negative when holds exceed what is left.
 */
export function computeSpendable(position: PositionSnapshot, stats: StatsSnapshot | null, pendingHolds: bigint): bigint {
  const bounds = [position.availableCredit];
  if (position.borrowableNow !== null) bounds.push(position.borrowableNow);
  if (stats) bounds.push(stats.lendable, stats.leverageHeadroom);
  const credit = min(...bounds);
  return position.cardBalance + (credit > 0n ? credit : 0n) - pendingHolds;
}

export interface DecisionInput {
  kind: AuthKind;
  amountCents: bigint;
  /** null: no agent has this card token. */
  agent: { cardEnabledOnChain: boolean } | null;
  /** null: neither a live read nor a usable cache. */
  position: PositionSnapshot | null;
  stats: StatsSnapshot | null;
  pendingHolds: bigint;
}

export interface Decision {
  result: AsaResult;
  /** Write a CardAuthorization row. */
  record: boolean;
  /** Follow up with `advance_pool.card_draw` (approved spend with a positive amount). */
  draw: boolean;
  spendable: bigint;
  /** BALANCE_INQUIRY only, cents. */
  balance?: { amount: number; available: number };
}

export function decideAuthorization(input: DecisionInput): Decision {
  const { kind, amountCents, agent, position, stats, pendingHolds } = input;

  // Unknown card: there is no agent to attach a row to.
  if (!agent) return { result: "SUSPECTED_FRAUD", record: false, draw: false, spendable: 0n };

  // Credits and anything new: approve and record, no on-chain action (spec §9.5).
  if (kind === "other") return { result: "APPROVED", record: true, draw: false, spendable: 0n };

  // A live read's card_enabled is authoritative; Agent.cardEnabledOnChain (its DB mirror) decides only without one.
  const enabled = position?.source === "chain" ? position.cardEnabled : agent.cardEnabledOnChain;
  const spendable = position ? computeSpendable(position, stats, pendingHolds) : 0n;

  if (kind === "balance_inquiry") {
    const cents = enabled && spendable > 0n ? Number(spendable / STROOPS_PER_CENT) : 0;
    return { result: "APPROVED", record: false, draw: false, spendable, balance: { amount: cents, available: cents } };
  }

  if (!enabled) return { result: "CARD_PAUSED", record: true, draw: false, spendable };
  // Zero-amount (card verification) authorizations move no funds.
  if (amountCents <= 0n) return { result: "APPROVED", record: true, draw: false, spendable };
  if (amountCents * STROOPS_PER_CENT <= spendable) return { result: "APPROVED", record: true, draw: true, spendable };
  return { result: "INSUFFICIENT_FUNDS", record: true, draw: false, spendable };
}
