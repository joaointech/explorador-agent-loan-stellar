// On-chain inputs for the ASA decision: `advance_pool.agent_position` and
// `stats()` read live within the ASA budget, falling back to the position
// cached on the Agent row (spec §9.5). The cache holds `jsonify(AgentPosition)`
// (bigints as decimal strings) and `cachedAt` = when that read started.

import { z } from "zod";

import { db, type Prisma } from "@/lib/db";
import { jsonify } from "@/lib/json";
import { readAgentPosition, readPoolStats } from "@/lib/stellar/contracts";
import type { AgentPosition } from "@/lib/types/chain";

import type { PositionSnapshot, StatsSnapshot } from "./decision";

/** RPC simulation budget inside the ASA handler (spec: 1.2 s). */
export const ASA_READ_TIMEOUT_MS = 1_200;
/** Cache refresh after a draw: off the critical path, so it can wait longer. */
const REFRESH_TIMEOUT_MS = 10_000;

/** Rejects after `ms` even if the underlying call ignores its own timeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function positionFromChain(p: AgentPosition): PositionSnapshot {
  return {
    cardBalance: p.cardBalance,
    cardEnabled: p.cardEnabled,
    availableCredit: p.availableCredit,
    borrowableNow: p.borrowableNow,
    source: "chain",
    cachedAt: null,
  };
}

const bigintish = z
  .union([z.bigint(), z.string().regex(/^-?\d+$/), z.number().int()])
  .transform((v) => BigInt(v));

const cachedPositionSchema = z.looseObject({
  cardBalance: bigintish,
  availableCredit: bigintish,
  borrowableNow: bigintish.optional(),
  cardEnabled: z.boolean().optional(),
});

/** Parses Agent.cachedPosition; null when absent or not an AgentPosition. */
export function parseCachedPosition(json: unknown, cachedAt: Date | null): PositionSnapshot | null {
  if (json === null || json === undefined) return null;
  const parsed = cachedPositionSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    cardBalance: parsed.data.cardBalance,
    cardEnabled: parsed.data.cardEnabled ?? true,
    availableCredit: parsed.data.availableCredit,
    borrowableNow: parsed.data.borrowableNow ?? null,
    source: "cache",
    cachedAt,
  };
}

export interface DecisionState {
  position: PositionSnapshot | null;
  stats: StatsSnapshot | null;
  /** The live position, when the read succeeded (used to refresh the cache). */
  live: AgentPosition | null;
  readStartedAt: Date;
}

interface AgentForDecision {
  smartAccount: string;
  cachedPosition: Prisma.JsonValue | null;
  cachedAt: Date | null;
}

const reason = (r: PromiseSettledResult<unknown>) =>
  r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : "";

/** Reads position and stats in parallel within the ASA budget; falls back to the cached position. */
export async function loadDecisionState(agent: AgentForDecision): Promise<DecisionState> {
  const readStartedAt = new Date();
  const opts = { timeoutMs: ASA_READ_TIMEOUT_MS };
  const [positionRead, statsRead] = await Promise.allSettled([
    withTimeout(readAgentPosition(agent.smartAccount, opts), ASA_READ_TIMEOUT_MS, "agent_position"),
    withTimeout(readPoolStats(opts), ASA_READ_TIMEOUT_MS, "stats"),
  ]);

  let position: PositionSnapshot | null;
  let live: AgentPosition | null = null;
  if (positionRead.status === "fulfilled") {
    live = positionRead.value;
    position = positionFromChain(live);
  } else {
    position = parseCachedPosition(agent.cachedPosition, agent.cachedAt);
    console.warn(
      `[asa] agent_position read failed (${reason(positionRead)}); ${position ? `using the position cached at ${agent.cachedAt?.toISOString()}` : "no cached position"}`,
    );
  }

  let stats: StatsSnapshot | null = null;
  if (statsRead.status === "fulfilled") {
    stats = { lendable: statsRead.value.lendable, leverageHeadroom: statsRead.value.leverageHeadroom };
  } else {
    console.warn(`[asa] stats read failed (${reason(statsRead)}); bounding credit by the position's borrowable_now`);
  }

  return { position, stats, live, readStartedAt };
}

/** Stores a position read that started at `readStartedAt`, unless a newer read is already cached. */
export async function writeCachedPosition(userId: string, position: AgentPosition, readStartedAt: Date): Promise<void> {
  await db.agent.updateMany({
    where: { userId, OR: [{ cachedAt: null }, { cachedAt: { lt: readStartedAt } }] },
    data: { cachedPosition: jsonify(position) as Prisma.InputJsonObject, cachedAt: readStartedAt },
  });
}

/** After a live read: cache it, and fix Agent.cardEnabledOnChain if it disagrees with the chain. */
export async function syncAgentFromChain(
  agent: { userId: string; cardEnabledOnChain: boolean },
  live: AgentPosition,
  readStartedAt: Date,
): Promise<void> {
  await writeCachedPosition(agent.userId, live, readStartedAt);
  if (live.cardEnabled !== agent.cardEnabledOnChain) {
    await db.agent.update({ where: { userId: agent.userId }, data: { cardEnabledOnChain: live.cardEnabled } });
  }
}

/** Re-reads the agent's position and caches it (after a draw). */
export async function refreshCachedPosition(agent: { userId: string; smartAccount: string }): Promise<void> {
  const readStartedAt = new Date();
  const position = await withTimeout(
    readAgentPosition(agent.smartAccount, { timeoutMs: REFRESH_TIMEOUT_MS }),
    REFRESH_TIMEOUT_MS,
    "agent_position",
  );
  await writeCachedPosition(agent.userId, position, readStartedAt);
}
