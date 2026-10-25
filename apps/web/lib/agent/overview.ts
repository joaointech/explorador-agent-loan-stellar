// GET /api/agent/overview (spec §9.7, §10.2 /agent): everything the agent app
// shows, in one response.
// - Live state from the contracts: `advance_pool.agent_position` and `stats()`
//   (RPC simulation with a timeout). A failed position read falls back to
//   Agent.cachedPosition; a successful one refreshes that cache (the ASA
//   fallback) and the Agent.cardEnabledOnChain mirror.
// - History from Postgres: CardAuthorization rows (real timestamps) and the
//   indexed ChainEvents naming the agent (settlements, cancellations,
//   withdrawals, write-offs, card enable/disable).
// - `rates` lets the client tick interest between refreshes (spec §5.2).
//
// Event rows are read tolerantly: the indexer stores PascalCase types with
// camelCase fields (`NoteSettled { noteId, agentPayout }`), raw contract names
// are snake_case (`note_settled { note_id, agent_payout }`); both work.

import { z } from "zod";

import { sumPendingHolds } from "@/lib/card/decision";
import { syncAgentFromChain, withTimeout } from "@/lib/card/position";
import { isSimulatedToken } from "@/lib/card/simulated-network";
import { db, type CardAuthorization, type Prisma } from "@/lib/db";
import { unauthorized } from "@/lib/http";
import { jsonify } from "@/lib/json";
import { getDeployment, readAgentPosition, readPoolStats } from "@/lib/stellar/contracts";
import type { ActivityItem, AgentDeal, AgentOverviewResponse, CpcvStatus } from "@/lib/types/api";
import type { AgentPosition, Jsonify, LineView } from "@/lib/types/chain";
import { BPS, DAY_SECS, PARAMS, SCALE, STROOPS_PER_CENT, creditLimitCents } from "@/lib/units";

/** RPC simulation budget for the dashboard (more relaxed than the ASA's 1.2 s; polled every ~10 s). */
export const OVERVIEW_READ_TIMEOUT_MS = 4_000;
/** Newest activity items returned (card rows and chain events merged). */
export const ACTIVITY_LIMIT = 50;
/** Indexed events read per agent (settlements, cancellations, withdrawals, …). */
const EVENT_SCAN_LIMIT = 200;

const EVENT_TYPES = {
  settled: ["NoteSettled", "note_settled"],
  cancelled: ["NoteCancelled", "note_cancelled"],
  withdrawn: ["BalanceWithdrawn", "balance_withdrawn"],
  writtenOff: ["DebtWrittenOff", "debt_written_off"],
  cardEnabled: ["CardEnabled", "card_enabled"],
} as const;
const AGENT_EVENT_TYPES: string[] = Object.values(EVENT_TYPES).flat();
const CLOCK_EVENT_TYPES = ["ClockAdvanced", "clock_advanced"];

// ---------- tolerant event field access ----------

type EventData = Record<string, unknown>;

const camel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function asData(value: Prisma.JsonValue | unknown): EventData {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as EventData) : {};
}

/** A field by its contract (snake_case) name, or its camelCase twin. */
function field(data: EventData, snake: string): unknown {
  return data[snake] ?? data[camel(snake)];
}

function bigintField(data: EventData, snake: string): bigint | null {
  const v = field(data, snake);
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

function numberField(data: EventData, snake: string): number | null {
  const v = bigintField(data, snake);
  return v === null ? null : Number(v);
}

function stringField(data: EventData, snake: string): string | null {
  const v = field(data, snake);
  return typeof v === "string" && v !== "" ? v : null;
}

// ---------- indexed events ----------

interface EventBase {
  /** `${txHash}:${eventIdx}` */
  id: string;
  ledger: number;
  eventIdx: number;
  txHash: string;
  /** Real (wall-clock) time: the ledger close time when the indexer recorded it, else when it was indexed. */
  at: string;
}

export type AgentEvent =
  | (EventBase & { kind: "settled"; noteId: number; agentPayout: bigint; debtRepaid: bigint })
  | (EventBase & { kind: "cancelled"; noteId: number; debtCarried: bigint; graceDeadline: number | null })
  | (EventBase & { kind: "withdrawn"; amount: bigint; to: string })
  | (EventBase & { kind: "written_off"; amount: bigint })
  | (EventBase & { kind: "card_enabled"; enabled: boolean });

export interface ChainEventRow {
  type: string;
  ledger: number;
  txHash: string;
  eventIdx: number;
  data: Prisma.JsonValue;
  createdAt: Date;
}

const is = (type: string, names: readonly string[]) => names.includes(type);

/** Normalizes one indexed event naming the agent; null for types the agent app doesn't show or malformed rows. */
export function parseAgentEvent(row: ChainEventRow): AgentEvent | null {
  const data = asData(row.data);
  const closedAt = stringField(data, "ledger_closed_at");
  const at = closedAt && !Number.isNaN(Date.parse(closedAt)) ? new Date(closedAt).toISOString() : row.createdAt.toISOString();
  const base: EventBase = { id: `${row.txHash}:${row.eventIdx}`, ledger: row.ledger, eventIdx: row.eventIdx, txHash: row.txHash, at };

  if (is(row.type, EVENT_TYPES.settled)) {
    const noteId = numberField(data, "note_id");
    if (noteId === null) return null;
    return { ...base, kind: "settled", noteId, agentPayout: bigintField(data, "agent_payout") ?? 0n, debtRepaid: bigintField(data, "debt_repaid") ?? 0n };
  }
  if (is(row.type, EVENT_TYPES.cancelled)) {
    const noteId = numberField(data, "note_id");
    if (noteId === null) return null;
    return { ...base, kind: "cancelled", noteId, debtCarried: bigintField(data, "debt_carried") ?? 0n, graceDeadline: numberField(data, "grace_deadline") };
  }
  if (is(row.type, EVENT_TYPES.withdrawn)) {
    const amount = bigintField(data, "amount");
    if (amount === null) return null;
    return { ...base, kind: "withdrawn", amount, to: stringField(data, "to") ?? "" };
  }
  if (is(row.type, EVENT_TYPES.writtenOff)) {
    return { ...base, kind: "written_off", amount: bigintField(data, "amount") ?? 0n };
  }
  if (is(row.type, EVENT_TYPES.cardEnabled)) {
    const enabled = field(data, "enabled");
    return typeof enabled === "boolean" ? { ...base, kind: "card_enabled", enabled } : null;
  }
  return null;
}

/** Chain order: ledger, then position in the transaction. */
const chainOrder = (a: Pick<EventBase, "ledger" | "eventIdx">, b: Pick<EventBase, "ledger" | "eventIdx">) => a.ledger - b.ledger || a.eventIdx - b.eventIdx;

async function loadAgentEvents(smartAccount: string, poolId: string | null): Promise<AgentEvent[]> {
  const rows = await db.chainEvent.findMany({
    where: {
      type: { in: AGENT_EVENT_TYPES },
      data: { path: ["agent"], equals: smartAccount },
      ...(poolId ? { contract: poolId } : {}),
    },
    orderBy: [{ ledger: "desc" }, { eventIdx: "desc" }],
    take: EVENT_SCAN_LIMIT,
    select: { type: true, ledger: true, txHash: true, eventIdx: true, data: true, createdAt: true },
  });
  return rows.map(parseAgentEvent).filter((e): e is AgentEvent => e !== null);
}

/**
 * Protocol clock estimate when `stats()` can't be read: wall clock + the demo
 * offset implied by the newest indexed ClockAdvanced (protocol_now − its ledger
 * close time), or the wall clock when none is indexed.
 */
async function estimateProtocolNow(nowMs: number, poolId: string | null): Promise<number> {
  const wall = Math.floor(nowMs / 1000);
  const row = await db.chainEvent
    .findFirst({
      where: { type: { in: CLOCK_EVENT_TYPES }, ...(poolId ? { contract: poolId } : {}) },
      orderBy: [{ ledger: "desc" }, { eventIdx: "desc" }],
      select: { data: true, createdAt: true },
    })
    .catch(() => null);
  if (!row) return wall;
  const data = asData(row.data);
  const protocolNow = numberField(data, "protocol_now");
  if (protocolNow === null) return wall;
  const closed = Date.parse(stringField(data, "ledger_closed_at") ?? "");
  const closedSecs = Math.floor((Number.isNaN(closed) ? row.createdAt.getTime() : closed) / 1000);
  return wall + Math.max(0, protocolNow - closedSecs);
}

// ---------- cached position ----------

const decimal = z
  .union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()])
  .transform((v) => BigInt(v).toString());

const cachedLineSchema = z.object({
  line: z.object({
    noteId: z.number().int(),
    agent: z.string(),
    creditLimit: decimal,
    principal: decimal,
    scaledDebt: decimal,
    escrituraDay: z.number().int(),
    status: z.enum(["Active", "Settled", "Cancelled"]),
  }),
  debt: decimal,
  interest: decimal,
  available: decimal,
});

const cachedPositionSchema = z.object({
  cardBalance: decimal,
  cardEnabled: z.boolean(),
  blocked: z.boolean().default(false),
  lines: z.array(cachedLineSchema).default([]),
  carriedDebt: decimal.default("0"),
  graceDeadline: decimal.nullable().default(null),
  totalDebt: decimal,
  totalPrincipal: decimal,
  availableCredit: decimal,
  borrowableNow: decimal,
});

/** Agent.cachedPosition (jsonify(AgentPosition)) as the response shape; null when absent or malformed. */
export function parseCachedAgentPosition(json: Prisma.JsonValue | null): Jsonify<AgentPosition> | null {
  if (json === null || json === undefined) return null;
  const parsed = cachedPositionSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// ---------- deals ----------

export interface DealSource {
  id: string;
  noteId: number | null;
  status: CpcvStatus;
  agentCommissionCents: bigint;
  escrituraDay: number;
  mintTxHash: string | null;
}

type SettledEvent = Extract<AgentEvent, { kind: "settled" }>;
type CancelledEvent = Extract<AgentEvent, { kind: "cancelled" }>;

/**
 * Display status of a minted deal. Postgres is updated by the admin routes and
 * the indexer; indexed events win while it lags (a settled or cancelled note
 * still MINTED in the database). A cancelled note followed by a write-off of
 * the agent's carried debt shows as WRITTEN_OFF (same rule as the registry).
 */
function dealStatus(dbStatus: CpcvStatus, settled: SettledEvent | undefined, cancelled: CancelledEvent | undefined, writeOffs: AgentEvent[]): CpcvStatus {
  if (dbStatus === "SETTLED" || dbStatus === "WRITTEN_OFF") return dbStatus;
  if (settled) return "SETTLED";
  if (dbStatus === "CANCELLED" || cancelled) {
    const writtenOff = cancelled !== undefined && writeOffs.some((w) => chainOrder(w, cancelled) > 0);
    return writtenOff ? "WRITTEN_OFF" : "CANCELLED";
  }
  return dbStatus;
}

const isActive = (d: AgentDeal) => d.status === "MINTED";

/** Active deals by escritura date (the draw order), then the rest newest first. */
function compareDeals(a: AgentDeal, b: AgentDeal): number {
  if (isActive(a) !== isActive(b)) return isActive(a) ? -1 : 1;
  if (isActive(a)) return a.escrituraDay - b.escrituraDay || (a.noteId ?? 0) - (b.noteId ?? 0);
  return (b.noteId ?? 0) - (a.noteId ?? 0);
}

/** A line on-chain without a Cpcv row (e.g. minted by a script): shown from chain data alone. */
function dealFromLine(view: Jsonify<LineView>, protocolDay: number): AgentDeal {
  const creditLimit = BigInt(view.line.creditLimit);
  return {
    cpcvId: `note-${view.line.noteId}`,
    noteId: view.line.noteId,
    status: "MINTED",
    agentCommission: ((creditLimit * BPS) / BigInt(PARAMS.ltvBps)).toString(),
    creditLimit: creditLimit.toString(),
    used: view.debt,
    escrituraDay: view.line.escrituraDay,
    overdue: protocolDay > view.line.escrituraDay,
    mintTxHash: null,
    agentPayout: null,
    debtCarried: null,
  };
}

/**
 * One deal per minted CPCV: credit limit and current debt ("used") from the
 * live line when it is active, the escritura date, Overdue when the protocol
 * day is past it (spec §2: no delay logic, just the badge), and the payout or
 * carried debt from indexed settlement/cancellation events.
 */
export function assembleDeals(input: {
  cpcvs: DealSource[];
  position: Jsonify<AgentPosition> | null;
  events: AgentEvent[];
  protocolDay: number;
}): AgentDeal[] {
  const { cpcvs, position, events, protocolDay } = input;
  const lines = new Map((position?.lines ?? []).map((v) => [v.line.noteId, v]));
  const ordered = [...events].sort(chainOrder);
  const settled = new Map<number, SettledEvent>();
  const cancelled = new Map<number, CancelledEvent>();
  for (const e of ordered) {
    if (e.kind === "settled") settled.set(e.noteId, e);
    if (e.kind === "cancelled") cancelled.set(e.noteId, e);
  }
  const writeOffs = ordered.filter((e) => e.kind === "written_off");

  const deals: AgentDeal[] = [];
  for (const c of cpcvs) {
    if (c.noteId === null) continue;
    const view = lines.get(c.noteId);
    const s = settled.get(c.noteId);
    const x = cancelled.get(c.noteId);
    const status = dealStatus(c.status, s, x, writeOffs);
    const creditLimit = view ? BigInt(view.line.creditLimit) : creditLimitCents(c.agentCommissionCents) * STROOPS_PER_CENT;
    deals.push({
      cpcvId: c.id,
      noteId: c.noteId,
      status,
      agentCommission: (c.agentCommissionCents * STROOPS_PER_CENT).toString(),
      creditLimit: creditLimit.toString(),
      used: status === "MINTED" && view ? view.debt : "0",
      escrituraDay: c.escrituraDay,
      overdue: status === "MINTED" && protocolDay > c.escrituraDay,
      mintTxHash: c.mintTxHash,
      agentPayout: s ? s.agentPayout.toString() : null,
      debtCarried: x ? x.debtCarried.toString() : null,
    });
  }

  const known = new Set(deals.map((d) => d.noteId));
  for (const view of position?.lines ?? []) {
    if (!known.has(view.line.noteId)) deals.push(dealFromLine(view, protocolDay));
  }
  return deals.sort(compareDeals);
}

// ---------- activity ----------

export type AuthorizationSource = Pick<
  CardAuthorization,
  "id" | "createdAt" | "merchant" | "amountCents" | "decision" | "declineReason" | "fromBalanceStroops" | "fromCreditStroops" | "chainStatus" | "txHash"
>;

/** Card transactions (real timestamps) merged with settlements, cancellations and withdrawals, newest first. */
export function assembleActivity(input: { authorizations: AuthorizationSource[]; events: AgentEvent[]; limit?: number }): ActivityItem[] {
  const items: ActivityItem[] = input.authorizations.map((a) => ({
    kind: "card",
    id: a.id,
    at: a.createdAt.toISOString(),
    merchant: a.merchant,
    amount: (a.amountCents * STROOPS_PER_CENT).toString(),
    decision: a.decision,
    declineReason: a.declineReason,
    fromBalance: a.fromBalanceStroops?.toString() ?? null,
    fromCredit: a.fromCreditStroops?.toString() ?? null,
    chainStatus: a.chainStatus,
    txHash: a.txHash,
  }));

  for (const e of input.events) {
    if (e.kind === "settled") {
      items.push({ kind: "settlement", id: e.id, at: e.at, noteId: e.noteId, agentPayout: e.agentPayout.toString(), debtRepaid: e.debtRepaid.toString(), txHash: e.txHash });
    } else if (e.kind === "cancelled") {
      items.push({ kind: "cancellation", id: e.id, at: e.at, noteId: e.noteId, debtCarried: e.debtCarried.toString(), graceDeadline: e.graceDeadline, txHash: e.txHash });
    } else if (e.kind === "withdrawn") {
      items.push({ kind: "withdrawal", id: e.id, at: e.at, amount: e.amount.toString(), to: e.to, txHash: e.txHash });
    }
  }

  return items
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, input.limit ?? ACTIVITY_LIMIT);
}

// ---------- the overview ----------

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

// One warning per distinct failure per process: the dashboard polls every ~10 s.
const warned = new Set<string>();
function warnOnce(what: string, err: unknown) {
  const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
  const key = `${what}:${message}`;
  if (warned.has(key)) return;
  warned.add(key);
  if (warned.size > 100) warned.clear();
  console.warn(`[agent overview] ${what} unavailable (${message}); falling back`);
}

export interface OverviewOptions {
  /** RPC simulation timeout per read. */
  readTimeoutMs?: number;
  /** Wall clock in ms (tests). */
  now?: () => number;
}

const fallbackRates = (protocolNow: number, fetchedAtMs: number): AgentOverviewResponse["rates"] => ({
  agentAprBps: PARAMS.agentAprBps,
  borrowIndex: SCALE.toString(),
  protocolNow,
  fetchedAtMs,
  live: false,
});

/** The signed-in agent's overview (onboarding flags, live position, deals, activity). */
export async function loadAgentOverview(userId: string, opts: OverviewOptions = {}): Promise<AgentOverviewResponse> {
  const timeoutMs = opts.readTimeoutMs ?? OVERVIEW_READ_TIMEOUT_MS;
  const now = opts.now ?? Date.now;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      displayName: true,
      passkeys: { select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      agent: {
        select: {
          userId: true,
          smartAccount: true,
          lithicCardToken: true,
          cardLast4: true,
          cardEnabledOnChain: true,
          signerKind: true,
          cachedPosition: true,
          cachedAt: true,
        },
      },
    },
  });
  if (!user) throw unauthorized();

  const agent = user.agent;
  const signerKind = agent?.signerKind === "demo-ed25519" ? "demo-ed25519" : "passkey";
  const userPart: AgentOverviewResponse["user"] = {
    email: user.email,
    displayName: user.displayName,
    // provisionAgent deploys the account for the oldest passkey; later ones can sign in but not sign card actions.
    passkeys: user.passkeys.map((p, i) => ({ id: p.id, createdAt: p.createdAt.toISOString(), signer: i === 0 && agent !== null && signerKind === "passkey" })),
  };

  if (!agent) {
    const nowMs = now();
    return {
      user: userPart,
      agent: { smartAccount: null, cardLast4: null, cardEnabledOnChain: false, signerKind, cardNetwork: null, cardPaused: false },
      onboarding: { passkey: user.passkeys.length > 0, smartAccount: false, card: false, cardActivated: false },
      position: null,
      rates: fallbackRates(Math.floor(nowMs / 1000), nowMs),
      deals: [],
      activity: [],
      positionSource: "none",
      positionAsOf: null,
      pendingHolds: "0",
    };
  }

  const poolIdRead = withTimeout(getDeployment(), timeoutMs, "deployment").then(
    (d) => d?.advancePool ?? null,
    () => null,
  );
  const readStartedAt = new Date(now());
  const [positionRead, statsRead, cpcvs, authorizations, events, poolId] = await Promise.all([
    settle(withTimeout(readAgentPosition(agent.smartAccount, { timeoutMs }), timeoutMs, "agent_position")),
    settle(withTimeout(readPoolStats({ timeoutMs }), timeoutMs, "stats")),
    db.cpcv.findMany({
      where: { agentId: userId, noteId: { not: null } },
      select: { id: true, noteId: true, status: true, agentCommissionCents: true, escrituraDay: true, mintTxHash: true },
    }),
    db.cardAuthorization.findMany({ where: { agentId: userId }, orderBy: { createdAt: "desc" }, take: ACTIVITY_LIMIT }),
    poolIdRead.then((id) => loadAgentEvents(agent.smartAccount, id)),
    poolIdRead,
  ]);

  // Position: live, else the cached copy (and say so).
  let position: Jsonify<AgentPosition> | null = null;
  let positionSource: "chain" | "cache" | "none" = "none";
  let positionAsOf: string | null = null;
  let cardEnabledOnChain = agent.cardEnabledOnChain;
  if (positionRead.ok) {
    position = jsonify(positionRead.value);
    positionSource = "chain";
    cardEnabledOnChain = positionRead.value.cardEnabled;
    await syncAgentFromChain(agent, positionRead.value, readStartedAt).catch((err: unknown) => warnOnce("position cache write", err));
  } else {
    warnOnce("agent_position", positionRead.error);
    position = parseCachedAgentPosition(agent.cachedPosition);
    if (position) {
      positionSource = "cache";
      positionAsOf = agent.cachedAt?.toISOString() ?? null;
    }
  }

  // Rates: interest ticks client-side only from a live index and a live position.
  const fetchedAtMs = now();
  let rates: AgentOverviewResponse["rates"];
  if (statsRead.ok) {
    const stats = statsRead.value;
    rates = {
      agentAprBps: stats.params.agentAprBps,
      borrowIndex: stats.borrowIndex.toString(),
      protocolNow: Number(stats.protocolNow),
      fetchedAtMs,
      live: positionRead.ok,
    };
  } else {
    warnOnce("stats", statsRead.error);
    rates = fallbackRates(await estimateProtocolNow(fetchedAtMs, poolId), fetchedAtMs);
  }

  // The activation step is done once enable_card has succeeded, even if the card is paused now.
  const everActivated =
    events.some((e) => e.kind === "card_enabled" && e.enabled) ||
    authorizations.some((a) => a.decision === "APPROVED" && a.chainStatus === "CONFIRMED" && a.amountCents > 0n);

  const pendingHolds =
    position === null
      ? 0n
      : sumPendingHolds(authorizations, { source: positionSource === "cache" ? "cache" : "chain", cachedAt: positionSource === "cache" ? agent.cachedAt : null });

  return {
    user: userPart,
    agent: {
      smartAccount: agent.smartAccount,
      cardLast4: agent.cardLast4,
      cardEnabledOnChain,
      signerKind,
      cardNetwork: agent.lithicCardToken ? (isSimulatedToken(agent.lithicCardToken) ? "simulated" : "lithic") : null,
      cardPaused: !cardEnabledOnChain && everActivated,
    },
    onboarding: {
      passkey: user.passkeys.length > 0,
      smartAccount: true,
      card: agent.lithicCardToken !== null,
      cardActivated: cardEnabledOnChain || everActivated,
    },
    position,
    rates,
    deals: assembleDeals({ cpcvs, position, events, protocolDay: Math.floor(rates.protocolNow / DAY_SECS) }),
    activity: assembleActivity({ authorizations, events }),
    positionSource,
    positionAsOf,
    pendingHolds: pendingHolds.toString(),
  };
}
