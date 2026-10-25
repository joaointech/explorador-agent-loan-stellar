// Retry sweep for card draws (spec §4.4.6, §9.5): approved spends whose
// on-chain draw FAILED, or that are stuck PENDING/SUBMITTED (the process died
// before or during the draw), get another attempt, up to MAX_DRAW_ATTEMPTS in
// total. Rows stuck after their last attempt are resolved from indexed events
// or marked FAILED so they show up as "unfunded card spend" for the admin.
// Runs from /api/cron/retry-draws and on admin page load; one sweep at a time.

import { db } from "@/lib/db";

import { authRefFor, executeDraw, findIndexedDraw, MAX_DRAW_ATTEMPTS } from "./draw";

/** A PENDING/SUBMITTED draw older than this is considered abandoned. */
export const STUCK_AFTER_MS = 2 * 60_000;
/** pg advisory lock key for the sweep ("card"); the operator tx lock uses its own key. */
const SWEEP_LOCK_KEY = 0x63617264n;

export interface RetrySweepResult {
  /** False when another sweep was already running. */
  ran: boolean;
  examined: number;
  confirmed: number;
  /** Already on-chain (DuplicateDraw or found in indexed events). */
  recovered: number;
  failed: number;
  skipped: number;
}

export interface RetrySweepOptions {
  /** Draws retried per sweep (each one is a testnet transaction). */
  limit?: number;
  stuckAfterMs?: number;
  /** Only this agent's draws (User.id). */
  agentId?: string;
}

export async function retryDraws(opts: RetrySweepOptions = {}): Promise<RetrySweepResult> {
  const limit = opts.limit ?? 5;
  const stuckBefore = new Date(Date.now() - (opts.stuckAfterMs ?? STUCK_AFTER_MS));
  const scope = opts.agentId ? { agentId: opts.agentId } : {};
  const result: RetrySweepResult = { ran: false, examined: 0, confirmed: 0, recovered: 0, failed: 0, skipped: 0 };

  return db.$transaction(
    async (tx) => {
      // The transaction only holds the lock; row updates commit on their own so pollers see them.
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}) AS locked`;
      if (!lock?.locked) return result;
      result.ran = true;

      // Out of attempts but never resolved: settle them from indexed events, else FAILED.
      const exhausted = await db.cardAuthorization.findMany({
        where: { ...scope, decision: "APPROVED", chainStatus: "SUBMITTED", attempts: { gte: MAX_DRAW_ATTEMPTS }, createdAt: { lt: stuckBefore } },
        select: { id: true, lithicToken: true },
      });
      for (const row of exhausted) {
        result.examined++;
        const indexed = await findIndexedDraw(Buffer.from(authRefFor(row.lithicToken)).toString("hex")).catch(() => null);
        await db.cardAuthorization.updateMany({
          where: { id: row.id, chainStatus: "SUBMITTED" },
          data: indexed ? { chainStatus: "CONFIRMED", ...indexed } : { chainStatus: "FAILED" },
        });
        result[indexed ? "recovered" : "failed"]++;
      }

      const candidates = await db.cardAuthorization.findMany({
        where: {
          ...scope,
          decision: "APPROVED",
          amountCents: { gt: 0 },
          attempts: { lt: MAX_DRAW_ATTEMPTS },
          OR: [{ chainStatus: "FAILED" }, { chainStatus: { in: ["PENDING", "SUBMITTED"] }, createdAt: { lt: stuckBefore } }],
        },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: { id: true, chainStatus: true, attempts: true },
      });
      for (const row of candidates) {
        result.examined++;
        result[await executeDraw(row.id, { from: [row.chainStatus], expectedAttempts: row.attempts })]++;
      }
      return result;
    },
    { maxWait: 5_000, timeout: 110_000 },
  );
}
