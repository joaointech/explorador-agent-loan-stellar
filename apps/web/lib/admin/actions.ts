// Admin actions on deals and the treasury (spec §4.5, §4.6, §7.3):
// confirm escritura (settle), cancel (buyer withdrew), write off, junior
// tranche deposit/withdraw and protocol fee claims. Each is one operator- or
// treasury-signed transaction through lib/stellar, then the database follows.

import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { HttpError, notFound } from "@/lib/http";
import {
  cancelNote,
  claimFees,
  explorerUrl,
  juniorDeposit,
  juniorWithdraw,
  readAgentPosition,
  readNote,
  readPoolStats,
  settleNote,
  writeOff,
} from "@/lib/stellar/contracts";
import type { AdminCpcvActionResponse, AdminWriteOffResponse, CpcvStatus, TxResponse } from "@/lib/types/api";
import { eurToStroops } from "@/lib/units";

import { chainHttpError, contractErrorCode } from "./chain-errors";
import { cpcvWithAgent, toAdminCpcvRow } from "./rows";

// One action per CPCV / agent at a time in this process (a double click must
// not send two transactions; the contract would reject the second anyway).
const inFlight = new Set<string>();

async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(key)) throw new HttpError(409, "IN_PROGRESS", "This action is already running");
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}

const VERB: Record<"settle" | "cancel", string> = { settle: "confirmed", cancel: "cancelled" };
const ON_CHAIN_STATUS: Record<string, CpcvStatus> = { Settled: "SETTLED", Cancelled: "CANCELLED" };

async function loadActiveCpcv(id: string, action: "settle" | "cancel") {
  const row = await db.cpcv.findUnique({ where: { id }, select: { id: true, status: true, noteId: true } });
  if (!row) throw notFound("There is no CPCV with this id");
  if (row.status !== "MINTED" || row.noteId === null) {
    throw new HttpError(409, "INVALID_STATUS", `Only active notes can be ${VERB[action]} (this CPCV is ${row.status.toLowerCase().replace("_", " ")})`);
  }
  return { id: row.id, noteId: row.noteId };
}

/**
 * The line is no longer active on-chain (#9): another admin, a retry or a
 * script got there first. Sync the row with the note's on-chain status and
 * explain, instead of failing with a bare contract error.
 */
async function reconcileInactiveLine(row: { id: string; noteId: number }, err: unknown): Promise<HttpError | null> {
  if (contractErrorCode(err) !== 9) return null;
  const note = await readNote(row.noteId).catch(() => null);
  const status = note ? ON_CHAIN_STATUS[note.status] : undefined;
  if (!status) return null;
  await db.cpcv.updateMany({ where: { id: row.id, status: "MINTED" }, data: { status } });
  return new HttpError(409, `ALREADY_${status}`, `Note #${row.noteId} is already ${note!.status.toLowerCase()} on-chain; the list now shows it.`);
}

async function noteAction(id: string, action: "settle" | "cancel"): Promise<AdminCpcvActionResponse> {
  return exclusive(`cpcv:${id}`, async () => {
    const row = await loadActiveCpcv(id, action);
    const call = action === "settle" ? settleNote : cancelNote;
    const { txHash } = await call(row.noteId).catch(async (err: unknown) => {
      throw (await reconcileInactiveLine(row, err)) ?? chainHttpError(err);
    });
    const updated = await db.cpcv.update({
      where: { id },
      data: action === "settle" ? { status: "SETTLED", settleTxHash: txHash, error: null } : { status: "CANCELLED", cancelTxHash: txHash, error: null },
      include: cpcvWithAgent,
    });
    return { cpcv: toAdminCpcvRow(updated, null), txHash, explorerUrl: explorerUrl("tx", txHash) };
  });
}

/** Confirm escritura: `advance_pool.settle(note_id)` (operator + treasury) → SETTLED. */
export const settleCpcv = (id: string) => noteAction(id, "settle");

/** Buyer walked away: `advance_pool.cancel(note_id)` (operator) → CANCELLED; the debt becomes carried debt. */
export const cancelCpcv = (id: string) => noteAction(id, "cancel");

/** `advance_pool.write_off(agent)` after the grace deadline; the agent's cancelled CPCVs become WRITTEN_OFF. */
export async function writeOffAgent(userId: string): Promise<AdminWriteOffResponse> {
  return exclusive(`agent:${userId}`, async () => {
    const agent = await db.agent.findUnique({ where: { userId }, select: { smartAccount: true, user: { select: { email: true } } } });
    if (!agent) throw notFound("There is no agent with a smart account with this id");

    // Clear messages before spending a transaction (the contract enforces the same rules).
    const live = await Promise.all([readAgentPosition(agent.smartAccount), readPoolStats()]).catch(() => null);
    if (live) {
      const [position, stats] = live;
      if (position.carriedDebt <= 0n) throw new HttpError(409, "NOTHING_TO_WRITE_OFF", `${agent.user.email} has no carried debt to write off`);
      if (position.graceDeadline !== null && stats.protocolNow < position.graceDeadline) {
        throw new HttpError(409, "GRACE_NOT_OVER", `The grace period of ${agent.user.email} ends on ${formatDate(position.graceDeadline)} (protocol clock)`);
      }
    }

    const { txHash } = await writeOff(agent.smartAccount).catch((err: unknown) => {
      throw chainHttpError(err);
    });
    const { count } = await db.cpcv.updateMany({ where: { agentId: userId, status: "CANCELLED" }, data: { status: "WRITTEN_OFF" } });
    return { txHash, explorerUrl: explorerUrl("tx", txHash), writtenOff: count };
  });
}

export type TreasuryAction = "junior-deposit" | "junior-withdraw" | "claim-fees";

const TREASURY_CALL: Record<TreasuryAction, (amount: bigint) => Promise<{ txHash: string }>> = {
  "junior-deposit": juniorDeposit,
  "junior-withdraw": juniorWithdraw,
  "claim-fees": claimFees,
};

const TREASURY_ERRORS: Record<TreasuryAction, Partial<Record<number, string>>> = {
  "junior-deposit": {},
  "junior-withdraw": {
    3: "That is more than the junior tranche holds",
    5: "Not enough idle liquidity in the pool to pay this out",
    6: "Withdrawing this much would push outstanding debt above 10× the junior tranche",
  },
  "claim-fees": {
    3: "That is more than the protocol fees accrued",
    5: "Not enough cash in the pool to pay these fees right now",
  },
};

/** Treasury-signed junior tranche and fee operations, `amountEur` with at most 2 decimals. */
export async function runTreasuryAction(action: TreasuryAction, amountEur: number): Promise<TxResponse> {
  return exclusive(`treasury:${action}`, async () => {
    const { txHash } = await TREASURY_CALL[action](eurToStroops(amountEur)).catch((err: unknown) => {
      throw chainHttpError(err, TREASURY_ERRORS[action]);
    });
    return { txHash, explorerUrl: explorerUrl("tx", txHash) };
  });
}
