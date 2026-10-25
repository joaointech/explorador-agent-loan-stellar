// Serializes transactions per source account (spec §9.3) so concurrent card
// draws never race on the operator's sequence number:
//  1. an in-process promise chain, so one process holds at most one DB
//     connection per account while waiting;
//  2. a Postgres transaction-level advisory lock (`pg_advisory_xact_lock`),
//     which serializes across processes (Next.js server, scripts, indexer)
//     and works through Neon's transaction-mode pooler.
// The lock is held from `getAccount` until the transaction is final, so the
// next transaction always sees the committed sequence number.

import { createHash } from "node:crypto";

import { db } from "@/lib/db";

/** Max wait for a pooled connection to open the locking transaction. */
const CONNECTION_WAIT_MS = 15_000;
/** Max lifetime of the locking transaction: queueing behind other processes + build/submit/poll. */
const LOCK_HOLD_MS = 180_000;

const g = globalThis as unknown as { stellarLockChains?: Map<string, Promise<void>> };
const chains = (g.stellarLockChains ??= new Map<string, Promise<void>>());

/** Stable signed 64-bit advisory lock key for an account (first 8 bytes of a namespaced sha256). */
export function advisoryLockKey(account: string): bigint {
  return createHash("sha256").update(`explorador-advance:tx-source:${account}`).digest().readBigInt64BE(0);
}

/** Runs `fn` after every earlier call with the same key in this process has settled. */
export async function inProcessMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  try {
    return await run;
  } finally {
    if (chains.get(key) === settled) chains.delete(key);
  }
}

/** Holds the advisory lock for `account` (in-process first, then Postgres) while `fn` runs. */
export async function withAccountLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const key = advisoryLockKey(account);
  return inProcessMutex(account, () =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`;
        return fn();
      },
      { maxWait: CONNECTION_WAIT_MS, timeout: LOCK_HOLD_MS },
    ),
  );
}
