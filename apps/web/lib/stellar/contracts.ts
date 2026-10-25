// Stellar service (spec §9.3): typed views via RPC simulation and
// operator-signed writes for teurc, cpcv_note and advance_pool. Other
// workstreams code against these signatures.
//
// Errors are HttpErrors (lib/stellar/errors.ts): a contract error surfaces as
// e.g. 409 GRACE_NOT_OVER / DUPLICATE_DRAW (`isContractError(err, "DuplicateDraw")`),
// a missing deployment as 503 NOT_DEPLOYED, RPC trouble as 502/504.

import { badRequest } from "@/lib/http";
import type { DeploymentInfo } from "@/lib/types/api";
import type { AgentPosition, DrawResult, LineView, Note, PoolStats } from "@/lib/types/chain";

import { adminKeypair, treasuryKeypair } from "./config";
import { decodeAgentPosition, decodeDrawResult, decodeLineView, decodeNote, decodeNotes, decodePoolStats, decodeU32Vec } from "./decode";
import { resolveDeployment } from "./deployment";
import { invokeAsOperator, type InvokeResult } from "./invoke";
import { asBigInt, asNumber, scAddress, scBool, scBytes, scI128, scStruct, scU32, scU64 } from "./scval";
import { readContract } from "./simulate";

export type { InvokeResult } from "./invoke";

export interface ReadOptions {
  /** RPC simulation timeout in ms (the ASA handler uses 1200). */
  timeoutMs?: number;
}

/** `cpcv_note.list` page size cap (spec §7.2). */
export const MAX_LIST_LIMIT = 50;

/** Contract ids from the active Deployment row, falling back to deployments/testnet.json. */
export async function getDeployment(): Promise<DeploymentInfo | null> {
  return (await resolveDeployment())?.info ?? null;
}

// ---------- views ----------

export async function readPoolStats(opts?: ReadOptions): Promise<PoolStats> {
  return readContract("advancePool", "stats", [], decodePoolStats, opts);
}

export async function readAgentPosition(agent: string, opts?: ReadOptions): Promise<AgentPosition> {
  return readContract("advancePool", "agent_position", [scAddress(agent)], decodeAgentPosition, opts);
}

export async function readLine(noteId: number): Promise<LineView> {
  return readContract("advancePool", "line", [scU32(noteId)], decodeLineView);
}

export async function readNote(id: number): Promise<Note> {
  return readContract("cpcvNote", "get", [scU32(id)], decodeNote);
}

/** `cpcv_note.list(start, limit)`, limit ≤ 50. */
export async function readNotes(start: number, limit: number): Promise<Note[]> {
  const capped = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit)));
  return readContract("cpcvNote", "list", [scU32(start), scU32(capped)], decodeNotes);
}

export async function readNoteCount(): Promise<number> {
  return readContract("cpcvNote", "count", [], (v) => asNumber(v, "count"));
}

export async function readNotesOf(agent: string): Promise<number[]> {
  return readContract("cpcvNote", "notes_of", [scAddress(agent)], decodeU32Vec);
}

export async function readProtocolNow(): Promise<bigint> {
  return readContract("advancePool", "protocol_now", [], (v) => asBigInt(v, "protocol_now"));
}

/** eaSR share balance. */
export async function readShareBalance(address: string): Promise<bigint> {
  return readContract("advancePool", "balance", [scAddress(address)], (v) => asBigInt(v, "balance"));
}

export async function readMaxWithdraw(owner: string): Promise<bigint> {
  return readContract("advancePool", "max_withdraw", [scAddress(owner)], (v) => asBigInt(v, "max_withdraw"));
}

// ---------- writes (operator-signed unless noted; serialized via a Postgres advisory lock) ----------

export interface MintNoteArgs {
  to: string;
  /** Soroban-formatted proof bytes (A already negated). */
  proof: { a: Uint8Array; b: Uint8Array; c: Uint8Array };
  totalCommissionCents: bigint;
  escrituraDay: number;
  commitment: Uint8Array;
  nullifier: Uint8Array;
}

function positive(amount: bigint, what: string): bigint {
  if (amount <= 0n) throw badRequest(`${what} must be positive`, "INVALID_AMOUNT");
  return amount;
}

/** `cpcv_note.mint`; resolves to the new note id. */
export async function mintNote(args: MintNoteArgs): Promise<InvokeResult<number>> {
  return invokeAsOperator(
    "cpcvNote",
    "mint",
    [
      scAddress(args.to),
      scStruct({ a: scBytes(args.proof.a, 64), b: scBytes(args.proof.b, 128), c: scBytes(args.proof.c, 64) }),
      scU64(args.totalCommissionCents),
      scU32(args.escrituraDay),
      scBytes(args.commitment, 32),
      scBytes(args.nullifier, 32),
    ],
    { decode: (v) => asNumber(v, "mint") },
  );
}

export async function cardDraw(agent: string, amount: bigint, authRef: Uint8Array): Promise<InvokeResult<DrawResult>> {
  return invokeAsOperator("advancePool", "card_draw", [scAddress(agent), scI128(positive(amount, "amount")), scBytes(authRef, 32)], {
    decode: (v) => decodeDrawResult(v),
  });
}

/** `advance_pool.settle`, signed by operator + treasury. */
export async function settleNote(noteId: number): Promise<InvokeResult<void>> {
  return invokeAsOperator("advancePool", "settle", [scU32(noteId)], { extraSigners: [treasuryKeypair()] });
}

export async function cancelNote(noteId: number): Promise<InvokeResult<void>> {
  return invokeAsOperator("advancePool", "cancel", [scU32(noteId)]);
}

export async function writeOff(agent: string): Promise<InvokeResult<void>> {
  return invokeAsOperator("advancePool", "write_off", [scAddress(agent)]);
}

export async function setBlocked(agent: string, blocked: boolean): Promise<InvokeResult<void>> {
  return invokeAsOperator("advancePool", "set_blocked", [scAddress(agent), scBool(blocked)]);
}

/** Treasury-signed. */
export async function juniorDeposit(amount: bigint): Promise<InvokeResult<void>> {
  return invokeAsOperator("advancePool", "junior_deposit", [scI128(positive(amount, "amount"))], { extraSigners: [treasuryKeypair()] });
}

/** Treasury-signed. */
export async function juniorWithdraw(amount: bigint): Promise<InvokeResult<void>> {
  return invokeAsOperator("advancePool", "junior_withdraw", [scI128(positive(amount, "amount"))], { extraSigners: [treasuryKeypair()] });
}

/** Treasury-signed. */
export async function claimFees(amount: bigint): Promise<InvokeResult<void>> {
  return invokeAsOperator("advancePool", "claim_fees", [scI128(positive(amount, "amount"))], { extraSigners: [treasuryKeypair()] });
}

/** Admin-signed; demo mode only. */
export async function advanceClock(secs: number): Promise<InvokeResult<void>> {
  if (!Number.isInteger(secs) || secs <= 0) throw badRequest("secs must be a positive integer", "INVALID_AMOUNT");
  return invokeAsOperator("advancePool", "advance_clock", [scU64(secs)], { extraSigners: [adminKeypair()] });
}

/** Server-side tEURC faucet fallback (spec §9.7 /api/faucet/teurc). */
export async function faucetTeurc(to: string, amount: bigint): Promise<InvokeResult<void>> {
  return invokeAsOperator("teurc", "faucet", [scAddress(to), scI128(positive(amount, "amount"))]);
}

/** https://stellar.expert/explorer/testnet/{tx|contract|account}/{id} (client components: import from lib/stellar/explorer). */
export { explorerUrl } from "./explorer";
