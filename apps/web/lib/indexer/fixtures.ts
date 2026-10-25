// Test fixtures: raw `getEvents` items exactly as the contracts emit them
// (`#[contractevent]` defaults: [snake_case name] topics + sorted, sparse data
// map; SEP-56 / SEP-41 layouts from OpenZeppelin stellar-tokens 0.8.0).
// Used by unit tests only.

import { Contract, xdr, type rpc } from "@stellar/stellar-sdk";

import { NOTE_ID, POOL_ID, TEURC_ID } from "@/lib/stellar/fixtures";
import { scAddress, scBool, scBytes, scI128, scStruct, scU32, scU64, scUnitEnum } from "@/lib/stellar/scval";

export const BASE_LEDGER = 5_300_000;
export const BASE_CLOSE = 1_792_000_000;

let seq = 0;
const nextHash = () => (++seq).toString(16).padStart(64, "0");

export interface RawEventOptions {
  contract?: string;
  ledger?: number;
  txHash?: string;
  index?: number;
  closedAt?: number;
  txOrder?: number;
}

/** A `getEvents` item: id = "<toid>-<index>" with toid = ledger << 32 | txOrder << 12. */
export function rawEvent(name: string, extraTopics: xdr.ScVal[], value: xdr.ScVal, o: RawEventOptions = {}): rpc.Api.EventResponse {
  const ledger = o.ledger ?? BASE_LEDGER;
  const toid = (BigInt(ledger) << 32n) | (BigInt(o.txOrder ?? 1) << 12n);
  return {
    id: `${toid.toString().padStart(19, "0")}-${String(o.index ?? 0).padStart(10, "0")}`,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date((o.closedAt ?? BASE_CLOSE + (ledger - BASE_LEDGER) * 5) * 1000).toISOString().replace(".000", ""),
    transactionIndex: o.txOrder ?? 1,
    operationIndex: 0,
    txHash: o.txHash ?? nextHash(),
    contractId: new Contract(o.contract ?? POOL_ID),
    topic: [xdr.ScVal.scvSymbol(name), ...extraTopics],
    value,
  };
}

/** A `#[contractevent]` with every field in the (sparse) data map. */
const custom = (name: string, fields: Record<string, xdr.ScVal | null>, o: RawEventOptions = {}) =>
  rawEvent(name, [], scStruct(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)) as Record<string, xdr.ScVal>), o);

export const ev = {
  noteMinted: (id: number, agent: string, totalCents: bigint, escrituraDay: number, commitmentFill = 0x11, o: RawEventOptions = {}) =>
    custom(
      "note_minted",
      {
        id: scU32(id),
        agent: scAddress(agent),
        total_commission: scI128(totalCents * 100_000n),
        agent_commission: scI128((totalCents / 2n) * 100_000n),
        escritura_day: scU32(escrituraDay),
        commitment: scBytes(new Uint8Array(32).fill(commitmentFill), 32),
        nullifier: scBytes(new Uint8Array(32).fill(0x22), 32),
      },
      { contract: NOTE_ID, ...o },
    ),
  noteStatusChanged: (id: number, status: "Active" | "Settled" | "Cancelled", o: RawEventOptions = {}) =>
    custom("note_status_changed", { id: scU32(id), status: scUnitEnum(status) }, { contract: NOTE_ID, ...o }),
  cardEnabled: (agent: string, enabled: boolean, o: RawEventOptions = {}) => custom("card_enabled", { agent: scAddress(agent), enabled: scBool(enabled) }, o),
  cardDraw: (agent: string, amount: bigint, fromBalance: bigint, fromCredit: bigint, authRef: Uint8Array, o: RawEventOptions = {}) =>
    custom(
      "card_draw",
      { agent: scAddress(agent), amount: scI128(amount), from_balance: scI128(fromBalance), from_credit: scI128(fromCredit), auth_ref: scBytes(authRef, 32) },
      o,
    ),
  lineOpened: (noteId: number, agent: string, creditLimit: bigint, o: RawEventOptions = {}) =>
    custom("line_opened", { note_id: scU32(noteId), agent: scAddress(agent), credit_limit: scI128(creditLimit) }, o),
  noteSettled: (noteId: number, agent: string, f: { total: bigint; debtRepaid: bigint; interestPaid: bigint; carriedRepaid?: bigint; agentPayout: bigint; juniorDeposit: bigint }, o: RawEventOptions = {}) =>
    custom(
      "note_settled",
      {
        note_id: scU32(noteId),
        agent: scAddress(agent),
        total_commission: scI128(f.total),
        debt_repaid: scI128(f.debtRepaid),
        interest_paid: scI128(f.interestPaid),
        carried_repaid: scI128(f.carriedRepaid ?? 0n),
        agent_payout: scI128(f.agentPayout),
        junior_deposit: scI128(f.juniorDeposit),
      },
      o,
    ),
  noteCancelled: (noteId: number, agent: string, debtCarried: bigint, graceDeadline: bigint | null, o: RawEventOptions = {}) =>
    custom(
      "note_cancelled",
      { note_id: scU32(noteId), agent: scAddress(agent), debt_carried: scI128(debtCarried), grace_deadline: graceDeadline === null ? null : scU64(graceDeadline) },
      o,
    ),
  debtWrittenOff: (agent: string, amount: bigint, juniorLoss: bigint, seniorLoss: bigint, o: RawEventOptions = {}) =>
    custom("debt_written_off", { agent: scAddress(agent), amount: scI128(amount), junior_loss: scI128(juniorLoss), senior_loss: scI128(seniorLoss) }, o),
  balanceWithdrawn: (agent: string, amount: bigint, to: string, o: RawEventOptions = {}) =>
    custom("balance_withdrawn", { agent: scAddress(agent), amount: scI128(amount), to: scAddress(to) }, o),
  juniorDeposit: (amount: bigint, o: RawEventOptions = {}) => custom("junior_deposit", { amount: scI128(amount) }, o),
  juniorWithdraw: (amount: bigint, o: RawEventOptions = {}) => custom("junior_withdraw", { amount: scI128(amount) }, o),
  feesClaimed: (amount: bigint, o: RawEventOptions = {}) => custom("fees_claimed", { amount: scI128(amount) }, o),
  clockAdvanced: (secs: bigint, protocolNow: bigint, o: RawEventOptions = {}) => custom("clock_advanced", { secs: scU64(secs), protocol_now: scU64(protocolNow) }, o),
  /** SEP-56 Deposit { #[topic] operator, #[topic] from, #[topic] receiver, assets, shares }. */
  deposit: (owner: string, assets: bigint, shares: bigint, o: RawEventOptions = {}) =>
    rawEvent("deposit", [scAddress(owner), scAddress(owner), scAddress(owner)], scStruct({ assets: scI128(assets), shares: scI128(shares) }), o),
  /** SEP-56 Withdraw { #[topic] operator, #[topic] receiver, #[topic] owner, assets, shares }. */
  withdraw: (owner: string, assets: bigint, shares: bigint, o: RawEventOptions = {}) =>
    rawEvent("withdraw", [scAddress(owner), scAddress(owner), scAddress(owner)], scStruct({ assets: scI128(assets), shares: scI128(shares) }), o),
  /** SEP-41 transfer: data is the amount as a single value. */
  transfer: (from: string, to: string, amount: bigint, o: RawEventOptions = {}) =>
    rawEvent("transfer", [scAddress(from), scAddress(to)], scI128(amount), { contract: TEURC_ID, ...o }),
};
