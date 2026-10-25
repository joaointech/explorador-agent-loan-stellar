// Live interest for the agent app (spec §5.2, §10.2). The pool's borrow index
// grows by simple interest between accruals and every debt is
// ceil(scaled × index / SCALE). Between overview refreshes the app extrapolates
// the index from the last read (`rates`) with advance_pool's own accrue()
// formula, so debt and interest keep moving on screen and re-sync with the
// contract on every refresh. Pure bigint math, safe in the browser.

import { toDecimalString } from "@/lib/format/money";
import type { AgentOverviewResponse } from "@/lib/types/api";
import type { AgentPosition, Jsonify } from "@/lib/types/chain";
import { BPS, SCALE, TOKEN_DECIMALS, YEAR_SECS } from "@/lib/units";

export type Rates = AgentOverviewResponse["rates"];

/** ceil(n / d) for n ≥ 0, d > 0. */
const ceilDiv = (n: bigint, d: bigint): bigint => (n + d - 1n) / d;

/** advance_pool `accrue()`: index + floor(index × apr_bps × dt / (BPS × YEAR)); dt in whole seconds. */
export function growIndex(index: bigint, aprBps: number, dtSecs: number): bigint {
  const dt = Math.floor(dtSecs);
  if (!(dt > 0)) return index;
  return index + (index * BigInt(aprBps) * BigInt(dt)) / (BPS * BigInt(YEAR_SECS));
}

/** Debt of a scaled position: ceil(scaled × index / SCALE), rounded up like the contract. */
export const debtOf = (scaled: bigint, index: bigint): bigint => ceilDiv(scaled * index, SCALE);

/** Scaled debt booked when borrowing `amount`: ceil(amount × SCALE / index). */
export const scaledForBorrow = (amount: bigint, index: bigint): bigint => ceilDiv(amount * SCALE, index);

/**
 * A debt read at `index0`, carried forward to `index1`: ceil(debt × index1 / index0).
 * Equal to the read value at index0 (no jump on refresh) and never decreasing.
 * Works for carried debt too, which AgentPosition reports without a scaled value.
 */
export function projectDebt(debt: bigint, index0: bigint, index1: bigint): bigint {
  if (debt <= 0n || index0 <= 0n || index1 <= index0) return debt;
  return ceilDiv(debt * index1, index0);
}

/** Protocol clock (unix seconds, fractional) at wall-clock `wallMs`, extrapolated from the last read; never runs backwards. */
export function protocolNowAt(rates: Pick<Rates, "protocolNow" | "fetchedAtMs">, wallMs: number): number {
  return rates.protocolNow + Math.max(0, wallMs - rates.fetchedAtMs) / 1000;
}

/** Whether interest may be extrapolated (a live index and a live position). */
export const canTick = (rates: Rates): boolean => rates.live !== false && BigInt(rates.borrowIndex) > 0n;

/** The borrow index at protocol time `nowSecs`; the last read index when ticking isn't allowed. */
export function indexAt(rates: Rates, nowSecs: number): bigint {
  const index0 = BigInt(rates.borrowIndex);
  if (!canTick(rates)) return index0;
  return growIndex(index0, rates.agentAprBps, nowSecs - rates.protocolNow);
}

export interface LiveLine {
  noteId: number;
  principal: bigint;
  debt: bigint;
  interest: bigint;
  creditLimit: bigint;
}

export interface LiveDebt {
  lines: LiveLine[];
  carriedDebt: bigint;
  /** Σ line debts + carried debt. */
  totalDebt: bigint;
  totalPrincipal: bigint;
  /** totalDebt − totalPrincipal. */
  interest: bigint;
}

/** The position's debts at protocol time `nowSecs`. */
export function liveDebt(position: Jsonify<AgentPosition>, rates: Rates, nowSecs: number): LiveDebt {
  const index0 = BigInt(rates.borrowIndex);
  const index1 = indexAt(rates, nowSecs);
  const lines = position.lines.map((v) => {
    const principal = BigInt(v.line.principal);
    const debt = projectDebt(BigInt(v.debt), index0, index1);
    return { noteId: v.line.noteId, principal, debt, interest: debt > principal ? debt - principal : 0n, creditLimit: BigInt(v.line.creditLimit) };
  });
  const carriedDebt = projectDebt(BigInt(position.carriedDebt), index0, index1);
  const totalDebt = lines.reduce((sum, l) => sum + l.debt, carriedDebt);
  const totalPrincipal = BigInt(position.totalPrincipal);
  return { lines, carriedDebt, totalDebt, totalPrincipal, interest: totalDebt > totalPrincipal ? totalDebt - totalPrincipal : 0n };
}

const precise = new Map<number, Intl.NumberFormat>();

/** A stroops amount with more cents digits, for ticking figures: `€88.767123`. */
export function formatEurPrecise(stroops: bigint, fractionDigits = 6): string {
  let nf = precise.get(fractionDigits);
  if (!nf) {
    nf = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
    precise.set(fractionDigits, nf);
  }
  return nf.format(toDecimalString(stroops, TOKEN_DECIMALS) as `${number}`);
}
