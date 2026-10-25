// Event indexer (spec §9.6): reads events of the three contracts from Soroban
// RPC `getEvents`, stores new ones in ChainEvent (idempotent on txHash +
// eventIdx), reconciles app tables, and writes a PoolSnapshot at most once per
// real minute. Runs sync-on-read (`syncIfStale`), from `/api/cron/sync` and
// from `pnpm indexer`.
//
// RPC facts this relies on (testnet RPC 30, verified): one request scans at
// most 10,000 ledgers and returns a cursor to continue from; retention is
// ~7 days (120,960 ledgers); a startLedger outside the retained range fails
// with "startLedger must be within the ledger range: A - B".

import type { rpc } from "@stellar/stellar-sdk";

import { db } from "@/lib/db";
import { readProtocolNow } from "@/lib/stellar/contracts";
import { resolveDeployment } from "@/lib/stellar/deployment";
import { RpcError } from "@/lib/stellar/errors";
import { getRpc, rpcCall, rpcErrorInfo } from "@/lib/stellar/rpc";

import { compareEvents, decodeEvent, EventType, ledgerOfCursor, parseCloseTime, type DecodedEvent } from "./events";
import { anchorFromClockEvent, assignProtocolTimes, needsCurrentOffset, type ClockAnchor } from "./protocol-time";
import { reconcile } from "./reconcile";
import { recordPoolSnapshot, SNAPSHOT_INTERVAL_MS } from "./snapshot";

const PAGE_LIMIT = 200;
/** Enough for a full retention window (13 scan windows) plus busy pages; the rest continues next sync. */
const MAX_PAGES = 40;
const RANGE_ERROR = /startLedger must be within the ledger range: (\d+) - (\d+)/;

export interface SyncResult {
  status: "ok" | "skipped" | "error";
  /** "no-deployment", or the error message. */
  reason?: string;
  fromLedger?: number;
  toLedger?: number;
  latestLedger?: number;
  pages: number;
  fetched: number;
  inserted: number;
  snapshot: boolean;
  /** Ledgers that aged out of RPC retention before they were indexed. */
  gap?: { from: number; to: number };
  durationMs: number;
}

interface FetchResult {
  events: rpc.Api.EventResponse[];
  fromLedger: number;
  lastLedger: number;
  latestLedger: number;
  latestCloseTime: number;
  pages: number;
  gap?: { from: number; to: number };
}

/** Pages through getEvents from `fromLedger` (inclusive) up to the RPC's latest ledger. */
export async function fetchEvents(contractIds: string[], fromLedger: number | null): Promise<FetchResult> {
  const server = getRpc();
  const filters: rpc.Api.EventFilter[] = [{ type: "contract", contractIds }];
  let start = fromLedger ?? (await rpcCall("getHealth", () => server.getHealth())).oldestLedger;
  let gap: FetchResult["gap"];

  const firstPage = (startLedger: number) => rpcCall("getEvents", () => server.getEvents({ startLedger, filters, limit: PAGE_LIMIT }));
  let page: rpc.Api.GetEventsResponse;
  try {
    page = await server.getEvents({ startLedger: start, filters, limit: PAGE_LIMIT });
  } catch (err) {
    const { message } = rpcErrorInfo(err);
    const range = RANGE_ERROR.exec(message);
    if (!range) throw new RpcError(`getEvents failed: ${message}`);
    const [oldest, latest] = [Number(range[1]), Number(range[2])];
    if (start < oldest) {
      gap = { from: start, to: oldest - 1 };
      console.warn(`[indexer] ledgers ${gap.from}–${gap.to} are past RPC retention; their events are lost`);
    } else if (start > latest) {
      console.warn(`[indexer] cursor ${start} is past the chain tip ${latest} (network reset?); rescanning retention`);
    }
    start = oldest;
    page = await firstPage(start);
  }

  const events = [...page.events];
  let pages = 1;
  while (pages < MAX_PAGES && page.cursor) {
    const reachedTip = page.events.length < PAGE_LIMIT && ledgerOfCursor(page.cursor) >= page.latestLedger;
    if (reachedTip) break;
    const cursor = page.cursor;
    page = await rpcCall("getEvents", () => server.getEvents({ cursor, filters, limit: PAGE_LIMIT }));
    events.push(...page.events);
    pages++;
  }
  const scanned = page.cursor ? ledgerOfCursor(page.cursor) : page.latestLedger;
  return {
    events,
    fromLedger: start,
    lastLedger: Math.max(start, Math.min(scanned, page.latestLedger)),
    latestLedger: page.latestLedger,
    latestCloseTime: parseCloseTime(page.latestLedgerCloseTime),
    pages,
    gap,
  };
}

/** Last stored ClockAdvanced of this pool at or before `ledger`. */
async function priorAnchor(poolId: string, ledger: number): Promise<ClockAnchor | null> {
  const row = await db.chainEvent.findFirst({
    where: { type: EventType.ClockAdvanced, contract: poolId, ledger: { lte: ledger } },
    orderBy: [{ ledger: "desc" }, { createdAt: "desc" }],
    select: { data: true },
  });
  if (!row) return null;
  return anchorFromClockEvent({ closedAt: parseCloseTime((row.data as { ledgerClosedAt?: string }).ledgerClosedAt), data: row.data });
}

/** protocol_now − latest ledger close time; below a minute it is ledger-vs-simulation noise. */
async function estimateCurrentOffset(latestCloseTime: number): Promise<number> {
  try {
    const offset = Number(await readProtocolNow()) - latestCloseTime;
    return offset < 60 ? 0 : offset;
  } catch {
    return 0;
  }
}

const iso = (secs: number) => new Date(secs * 1000).toISOString();

/** One indexing pass for the current deployment. */
export async function syncEvents(opts: { snapshot?: boolean } = {}): Promise<SyncResult> {
  const started = Date.now();
  const empty = { pages: 0, fetched: 0, inserted: 0, snapshot: false };
  const deployment = await resolveDeployment();
  if (!deployment) return { status: "skipped", reason: "no-deployment", ...empty, durationMs: Date.now() - started };

  const { teurc, cpcvNote, advancePool } = deployment.info;
  const cursorId = `events:${deployment.key}`;
  const cursor = await db.indexerCursor.findUnique({ where: { id: cursorId } });
  const fetched = await fetchEvents([teurc, cpcvNote, advancePool], cursor?.lastLedger ?? null);

  const decoded = fetched.events.map(decodeEvent).filter((e): e is DecodedEvent => e !== null).sort(compareEvents);
  const existing = decoded.length
    ? await db.chainEvent.findMany({ where: { txHash: { in: [...new Set(decoded.map((e) => e.txHash))] } }, select: { txHash: true, eventIdx: true } })
    : [];
  const seen = new Set(existing.map((r) => `${r.txHash}:${r.eventIdx}`));
  const fresh = decoded.filter((e) => !seen.has(`${e.txHash}:${e.eventIdx}`));

  let inserted = 0;
  if (fresh.length > 0) {
    const prior = await priorAnchor(advancePool, fresh[0].ledger);
    const current = needsCurrentOffset(fresh, prior) ? await estimateCurrentOffset(fetched.latestCloseTime) : 0;
    const times = assignProtocolTimes(fresh, prior, current);
    const res = await db.chainEvent.createMany({
      data: fresh.map((e, i) => ({
        contract: e.contract,
        type: e.type,
        ledger: e.ledger,
        txHash: e.txHash,
        eventIdx: e.eventIdx,
        data: { ...e.data, ledgerClosedAt: iso(e.closedAt) },
        protocolTs: BigInt(times[i]),
      })),
      skipDuplicates: true,
    });
    inserted = res.count;
    await reconcile(fresh);
  }

  await db.indexerCursor.upsert({
    where: { id: cursorId },
    create: { id: cursorId, lastLedger: fetched.lastLedger },
    update: { lastLedger: fetched.lastLedger },
  });

  let snapshot = false;
  const s = indexerState();
  if (opts.snapshot !== false && Date.now() >= s.snapshotRetryAt) {
    try {
      snapshot = await recordPoolSnapshot();
      s.snapshotError = undefined;
    } catch (err) {
      // e.g. the pool isn't reachable: back off for a minute and log each distinct failure once
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      s.snapshotRetryAt = Date.now() + SNAPSHOT_INTERVAL_MS;
      if (s.snapshotError !== message) console.warn(`[indexer] snapshot skipped: ${message}`);
      s.snapshotError = message;
    }
  }

  return {
    status: "ok",
    fromLedger: fetched.fromLedger,
    toLedger: fetched.lastLedger,
    latestLedger: fetched.latestLedger,
    pages: fetched.pages,
    fetched: decoded.length,
    inserted,
    snapshot,
    gap: fetched.gap,
    durationMs: Date.now() - started,
  };
}

// ---------- single-flight + sync-on-read ----------

type IndexerState = { lastSyncAt: number; inflight?: Promise<SyncResult>; snapshotRetryAt: number; snapshotError?: string };
const g = globalThis as unknown as { advanceIndexer?: IndexerState };
function indexerState(): IndexerState {
  return (g.advanceIndexer ??= { lastSyncAt: 0, snapshotRetryAt: 0 });
}

/** Runs a sync now, or joins the one already running in this process. Never throws. */
export function runSync(opts: { snapshot?: boolean } = {}): Promise<SyncResult> {
  const s = indexerState();
  if (!s.inflight) {
    const started = Date.now();
    s.inflight = syncEvents(opts)
      .catch((err): SyncResult => {
        const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
        console.warn(`[indexer] sync failed: ${reason}`);
        return { status: "error", reason, pages: 0, fetched: 0, inserted: 0, snapshot: false, durationMs: Date.now() - started };
      })
      .finally(() => {
        s.lastSyncAt = Date.now();
        s.inflight = undefined;
      });
  }
  return s.inflight;
}

/**
 * Sync-on-read for public/agent/investor routes: syncs when the last pass is
 * older than `maxAgeMs`, waiting at most `waitMs` (the pass continues in the
 * background) so a slow RPC never blocks a read. Returns null when skipped or
 * still running.
 */
export async function syncIfStale(maxAgeMs = 10_000, opts: { waitMs?: number } = {}): Promise<SyncResult | null> {
  const s = indexerState();
  if (!s.inflight && Date.now() - s.lastSyncAt < maxAgeMs) return null;
  const run = runSync();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), opts.waitMs ?? 4_000);
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
