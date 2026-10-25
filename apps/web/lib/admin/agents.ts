// The admin Agents table (spec §10.2): every AGENT user, their smart account
// and card from Postgres, and debt / carried debt / grace deadline / blocked
// from a live `agent_position` read (falling back to the position the ASA
// handler cached on the Agent row).

import { z } from "zod";

import { db, type Prisma } from "@/lib/db";
import { readAgentPosition } from "@/lib/stellar/contracts";
import type { AdminAgentRow, DemoClock } from "@/lib/types/api";
import type { AgentPosition } from "@/lib/types/chain";

/** Per-agent read budget: the table should render even if one read hangs. */
const POSITION_TIMEOUT_MS = 8_000;

interface PositionFields {
  totalDebt: bigint;
  carriedDebt: bigint;
  graceDeadline: bigint | null;
  blocked: boolean;
}

const bigintish = z.union([z.bigint(), z.string().regex(/^-?\d+$/), z.number().int()]).transform((v) => BigInt(v));

const cachedPositionSchema = z.looseObject({
  totalDebt: bigintish.default(0n),
  carriedDebt: bigintish.default(0n),
  graceDeadline: bigintish.nullish().transform((v) => v ?? null),
  blocked: z.boolean().default(false),
});

/** Reads the fields the table needs from Agent.cachedPosition (`jsonify(AgentPosition)`); null if absent or malformed. */
export function parseCachedPositionFields(json: Prisma.JsonValue | null): PositionFields | null {
  if (json === null || json === undefined) return null;
  const parsed = cachedPositionSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`agent_position timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** carried debt > 0 and the protocol clock has reached the grace deadline (spec §4.6). */
export function canWriteOff(position: Pick<PositionFields, "carriedDebt" | "graceDeadline">, protocolNow: number | null): boolean {
  return position.carriedDebt > 0n && position.graceDeadline !== null && protocolNow !== null && BigInt(Math.floor(protocolNow)) >= position.graceDeadline;
}

const agentUserSelect = {
  id: true,
  email: true,
  displayName: true,
  agent: { select: { smartAccount: true, cardLast4: true, cardEnabledOnChain: true, cachedPosition: true } },
} satisfies Prisma.UserSelect;

type AgentUser = Prisma.UserGetPayload<{ select: typeof agentUserSelect }>;

/** One table row: the live position when the read succeeded, else the cached one. */
function toRow(user: AgentUser, counts: { notes: number; active: number }, live: AgentPosition | undefined, protocolNow: number | null): AdminAgentRow {
  const cached = user.agent ? parseCachedPositionFields(user.agent.cachedPosition) : null;
  const position: PositionFields | null = live ?? cached;
  const source: AdminAgentRow["positionSource"] = live ? "chain" : cached ? "cache" : "none";
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    smartAccount: user.agent?.smartAccount ?? null,
    cardLast4: user.agent?.cardLast4 ?? null,
    cardEnabledOnChain: user.agent?.cardEnabledOnChain ?? false,
    notes: counts.notes,
    activeNotes: counts.active,
    debt: (position?.totalDebt ?? 0n).toString(),
    carriedDebt: (position?.carriedDebt ?? 0n).toString(),
    graceDeadline: position?.graceDeadline === null || position?.graceDeadline === undefined ? null : Number(position.graceDeadline),
    blocked: position?.blocked ?? false,
    canWriteOff: position ? canWriteOff(position, protocolNow) : false,
    positionSource: source,
  };
}

/** All agents (newest first) with their on-chain position. Reads run in parallel; a failed read falls back to the cache. */
export async function listAdminAgents(clock: DemoClock | null, where: Prisma.UserWhereInput = {}): Promise<AdminAgentRow[]> {
  const [users, noteCounts, activeCounts] = await Promise.all([
    db.user.findMany({ where: { ...where, role: "AGENT" }, select: agentUserSelect, orderBy: { createdAt: "desc" } }),
    db.cpcv.groupBy({ by: ["agentId"], where: { noteId: { not: null } }, _count: { _all: true } }),
    db.cpcv.groupBy({ by: ["agentId"], where: { status: "MINTED" }, _count: { _all: true } }),
  ]);
  const notes = new Map(noteCounts.map((c) => [c.agentId, c._count._all]));
  const active = new Map(activeCounts.map((c) => [c.agentId, c._count._all]));

  const accounts = users.flatMap((u) => (u.agent ? [u.agent.smartAccount] : []));
  const reads = await Promise.allSettled(accounts.map((a) => withTimeout(readAgentPosition(a), POSITION_TIMEOUT_MS)));
  const live = new Map<string, AgentPosition>();
  reads.forEach((r, i) => {
    if (r.status === "fulfilled") live.set(accounts[i], r.value);
  });
  const failed = reads.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    console.warn(`[admin] agent_position reads failed for ${reads.filter((r) => r.status === "rejected").length}/${reads.length} agents: ${failed.reason instanceof Error ? failed.reason.message : String(failed.reason)}`);
  }

  const protocolNow = clock?.protocolNow ?? null;
  return users.map((u) =>
    toRow(u, { notes: notes.get(u.id) ?? 0, active: active.get(u.id) ?? 0 }, u.agent ? live.get(u.agent.smartAccount) : undefined, protocolNow),
  );
}
