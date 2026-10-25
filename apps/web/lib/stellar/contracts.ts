// Interface owned by the Stellar service workstream (spec §9.3): typed views
// via RPC simulation and operator-signed writes for teurc, cpcv_note and
// advance_pool. Other workstreams code against these signatures; the
// implementation replaces the stub bodies.

import { notImplemented } from "@/lib/http";
import type { DeploymentInfo } from "@/lib/types/api";
import type { AgentPosition, DrawResult, LineView, Note, PoolStats } from "@/lib/types/chain";

const OWNER = "stellar service";

export interface InvokeResult<T> {
  txHash: string;
  ledger: number;
  result: T;
}

export interface ReadOptions {
  /** RPC simulation timeout in ms (the ASA handler uses 1200). */
  timeoutMs?: number;
}

/** Contract ids from the active Deployment row, falling back to deployments/testnet.json. */
export async function getDeployment(): Promise<DeploymentInfo | null> {
  notImplemented("getDeployment", OWNER);
}

// ---------- views ----------

export async function readPoolStats(_opts?: ReadOptions): Promise<PoolStats> {
  notImplemented("readPoolStats", OWNER);
}

export async function readAgentPosition(_agent: string, _opts?: ReadOptions): Promise<AgentPosition> {
  notImplemented("readAgentPosition", OWNER);
}

export async function readLine(_noteId: number): Promise<LineView> {
  notImplemented("readLine", OWNER);
}

export async function readNote(_id: number): Promise<Note> {
  notImplemented("readNote", OWNER);
}

/** `cpcv_note.list(start, limit)`, limit ≤ 50. */
export async function readNotes(_start: number, _limit: number): Promise<Note[]> {
  notImplemented("readNotes", OWNER);
}

export async function readNoteCount(): Promise<number> {
  notImplemented("readNoteCount", OWNER);
}

export async function readNotesOf(_agent: string): Promise<number[]> {
  notImplemented("readNotesOf", OWNER);
}

export async function readProtocolNow(): Promise<bigint> {
  notImplemented("readProtocolNow", OWNER);
}

/** eaSR share balance. */
export async function readShareBalance(_address: string): Promise<bigint> {
  notImplemented("readShareBalance", OWNER);
}

export async function readMaxWithdraw(_owner: string): Promise<bigint> {
  notImplemented("readMaxWithdraw", OWNER);
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

/** `cpcv_note.mint`; resolves to the new note id. */
export async function mintNote(_args: MintNoteArgs): Promise<InvokeResult<number>> {
  notImplemented("mintNote", OWNER);
}

export async function cardDraw(_agent: string, _amount: bigint, _authRef: Uint8Array): Promise<InvokeResult<DrawResult>> {
  notImplemented("cardDraw", OWNER);
}

/** `advance_pool.settle`, signed by operator + treasury. */
export async function settleNote(_noteId: number): Promise<InvokeResult<void>> {
  notImplemented("settleNote", OWNER);
}

export async function cancelNote(_noteId: number): Promise<InvokeResult<void>> {
  notImplemented("cancelNote", OWNER);
}

export async function writeOff(_agent: string): Promise<InvokeResult<void>> {
  notImplemented("writeOff", OWNER);
}

export async function setBlocked(_agent: string, _blocked: boolean): Promise<InvokeResult<void>> {
  notImplemented("setBlocked", OWNER);
}

/** Treasury-signed. */
export async function juniorDeposit(_amount: bigint): Promise<InvokeResult<void>> {
  notImplemented("juniorDeposit", OWNER);
}

/** Treasury-signed. */
export async function juniorWithdraw(_amount: bigint): Promise<InvokeResult<void>> {
  notImplemented("juniorWithdraw", OWNER);
}

/** Treasury-signed. */
export async function claimFees(_amount: bigint): Promise<InvokeResult<void>> {
  notImplemented("claimFees", OWNER);
}

/** Admin-signed; demo mode only. */
export async function advanceClock(_secs: number): Promise<InvokeResult<void>> {
  notImplemented("advanceClock", OWNER);
}

/** Server-side tEURC faucet fallback (spec §9.7 /api/faucet/teurc). */
export async function faucetTeurc(_to: string, _amount: bigint): Promise<InvokeResult<void>> {
  notImplemented("faucetTeurc", OWNER);
}

/** https://stellar.expert/explorer/testnet/{tx|contract|account}/{id} */
export function explorerUrl(kind: "tx" | "contract" | "account", id: string): string {
  return `https://stellar.expert/explorer/testnet/${kind}/${id}`;
}
