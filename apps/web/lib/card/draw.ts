// The asynchronous half of a card purchase (spec §4.4 steps 4–6): record the
// approved spend on-chain with `advance_pool.card_draw(agent, amount, auth_ref)`
// as operator and update the CardAuthorization row:
//   PENDING → SUBMITTED → CONFIRMED (split + tx hash) | FAILED
// After a confirmed draw, a Lithic sandbox authorization is cleared (clearing.ts).
// A row is claimed atomically before submitting, so after(), the status-poll
// kick and the retry sweep can never draw it twice; and the contract rejects a
// reused auth_ref (DuplicateDraw), so a resubmission after a lost response is
// safe too.

import { createHash } from "node:crypto";

import { db, type ChainStatus } from "@/lib/db";
import { cardDraw } from "@/lib/stellar/contracts";
import { STROOPS_PER_CENT } from "@/lib/units";

import { clearLithicAuthorization } from "./clearing";
import { refreshCachedPosition } from "./position";

/** Spec §4.4.6 / §9.5: never more than 3 automatic attempts per draw. */
export const MAX_DRAW_ATTEMPTS = 3;

/** auth_ref = sha256(Lithic transaction token): the contract's duplicate-draw key. */
export function authRefFor(lithicToken: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(lithicToken, "utf8").digest());
}

/** `Error::DuplicateDraw = 12` (contracts/shared/src/errors.rs), as surfaced by RPC simulation or the SDK. */
export function isDuplicateDrawError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (/DuplicateDraw|Error\(Contract, #12\)/.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

const toBigint = (v: unknown): bigint | undefined => {
  if (typeof v === "bigint") return v;
  if ((typeof v === "string" && /^-?\d+$/.test(v)) || (typeof v === "number" && Number.isInteger(v))) return BigInt(v);
  return undefined;
};

/** Best effort: the split and tx hash of an already-landed draw, from indexed `card_draw` events. */
export async function findIndexedDraw(authRefHex: string) {
  const events = await db.chainEvent.findMany({
    where: { type: { in: ["card_draw", "CardDraw"] } },
    orderBy: { ledger: "desc" },
    take: 200,
    select: { data: true, txHash: true },
  });
  for (const event of events) {
    const data = event.data as Record<string, unknown> | null;
    const ref = data?.auth_ref ?? data?.authRef;
    if (typeof ref !== "string" || ref.toLowerCase().replace(/^0x/, "") !== authRefHex) continue;
    return {
      txHash: event.txHash,
      fromBalanceStroops: toBigint(data?.from_balance ?? data?.fromBalance),
      fromCreditStroops: toBigint(data?.from_credit ?? data?.fromCredit),
    };
  }
  return null;
}

export type DrawOutcome = "confirmed" | "recovered" | "failed" | "skipped";

export interface ExecuteDrawOptions {
  /** Chain statuses the row may be claimed from (default: PENDING, i.e. a fresh approval). */
  from?: ChainStatus[];
  /** Optimistic check used by the retry sweep: claim only if `attempts` still has this value. */
  expectedAttempts?: number;
}

/** Claims an approved, undrawn authorization and records it on-chain. Never throws for chain errors. */
export async function executeDraw(authorizationId: string, opts: ExecuteDrawOptions = {}): Promise<DrawOutcome> {
  const claimed = await db.cardAuthorization.updateMany({
    where: {
      id: authorizationId,
      decision: "APPROVED",
      amountCents: { gt: 0 },
      chainStatus: { in: opts.from ?? ["PENDING"] },
      attempts: opts.expectedAttempts ?? { lt: MAX_DRAW_ATTEMPTS },
    },
    data: { chainStatus: "SUBMITTED", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "skipped";

  const row = await db.cardAuthorization.findUniqueOrThrow({
    where: { id: authorizationId },
    include: { agent: { select: { userId: true, smartAccount: true } } },
  });
  const authRef = authRefFor(row.lithicToken);

  try {
    const { txHash, result } = await cardDraw(row.agent.smartAccount, row.amountCents * STROOPS_PER_CENT, authRef);
    await db.cardAuthorization.update({
      where: { id: row.id },
      data: { chainStatus: "CONFIRMED", fromBalanceStroops: result.fromBalance, fromCreditStroops: result.fromCredit, txHash },
    });
    console.info(`[card] draw ${row.id} confirmed: ${txHash} (attempt ${row.attempts})`);
    await clearLithicAuthorization(row.lithicToken);
    return "confirmed";
  } catch (err) {
    if (isDuplicateDrawError(err)) {
      // An earlier attempt already landed: the funds moved, so the spend is confirmed.
      const indexed = await findIndexedDraw(Buffer.from(authRef).toString("hex")).catch(() => null);
      await db.cardAuthorization.updateMany({
        where: { id: row.id, chainStatus: { not: "CONFIRMED" } },
        data: { chainStatus: "CONFIRMED", ...indexed },
      });
      console.info(`[card] draw ${row.id} had already landed (DuplicateDraw)`);
      await clearLithicAuthorization(row.lithicToken);
      return "recovered";
    }
    console.error(`[card] draw ${row.id} failed (attempt ${row.attempts}/${MAX_DRAW_ATTEMPTS})`, err);
    await db.cardAuthorization.updateMany({ where: { id: row.id, chainStatus: "SUBMITTED" }, data: { chainStatus: "FAILED" } });
    return "failed";
  } finally {
    await refreshCachedPosition(row.agent).catch((err: unknown) =>
      console.warn(`[card] cachedPosition refresh failed for ${row.agent.userId}: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}
