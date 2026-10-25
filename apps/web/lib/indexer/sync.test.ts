import type { rpc } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT, INVESTOR, NOTE_ID, POOL_ID, TEURC_ID } from "@/lib/stellar/fixtures";

import { ledgerOfCursor, type DecodedEvent } from "./events";
import { BASE_CLOSE, BASE_LEDGER, ev } from "./fixtures";

// ---------- fake RPC with testnet semantics ----------

interface Chain {
  events: rpc.Api.EventResponse[];
  oldest: number;
  latest: number;
}
const chain: Chain = { events: [], oldest: BASE_LEDGER - 25_000, latest: BASE_LEDGER + 100 };
const endOfLedgerCursor = (ledger: number) => `${((BigInt(ledger) << 32n) | 0xffffffffn).toString().padStart(19, "0")}-4294967295`;

const getEvents = vi.fn(async (req: rpc.Api.GetEventsRequest) => {
  let start: number;
  let after: string | null = null;
  if (req.cursor) {
    after = req.cursor;
    start = ledgerOfCursor(req.cursor);
  } else {
    start = req.startLedger!;
    if (start < chain.oldest || start > chain.latest) {
      throw Object.assign(new Error(`startLedger must be within the ledger range: ${chain.oldest} - ${chain.latest}`), { code: -32600 });
    }
  }
  const windowEnd = Math.min(start + 9_999, chain.latest);
  const ids = req.filters[0].contractIds ?? [];
  const matching = [...chain.events]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .filter((e) => e.ledger >= start && e.ledger <= windowEnd && (after === null || e.id > after) && ids.includes(e.contractId!.contractId()));
  const limit = req.limit ?? 100;
  const page = matching.slice(0, limit);
  return {
    events: page,
    cursor: page.length === limit ? page[page.length - 1].id : endOfLedgerCursor(windowEnd),
    latestLedger: chain.latest,
    oldestLedger: chain.oldest,
    latestLedgerCloseTime: String(BASE_CLOSE + (chain.latest - BASE_LEDGER) * 5),
    oldestLedgerCloseTime: String(BASE_CLOSE),
  };
});
const getHealth = vi.fn(async () => ({ status: "healthy", oldestLedger: chain.oldest, latestLedger: chain.latest, ledgerRetentionWindow: 120_960 }));

vi.mock("@/lib/stellar/rpc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stellar/rpc")>();
  return { ...mod, getRpc: () => ({ getEvents, getHealth }) };
});

let deployed = true;
vi.mock("@/lib/stellar/deployment", () => ({
  resolveDeployment: async () =>
    deployed ? { key: "k1", info: { teurc: TEURC_ID, cpcvNote: NOTE_ID, advancePool: POOL_ID }, createdAt: null, source: "db", wasmHashes: {} } : null,
}));
const readProtocolNow = vi.fn();
vi.mock("@/lib/stellar/contracts", () => ({ readProtocolNow: () => readProtocolNow() }));

const reconcile = vi.fn(async (_events: DecodedEvent[]) => {});
vi.mock("./reconcile", () => ({ reconcile: (events: DecodedEvent[]) => reconcile(events) }));
const recordPoolSnapshot = vi.fn(async () => true);
vi.mock("./snapshot", () => ({ recordPoolSnapshot: () => recordPoolSnapshot(), SNAPSHOT_INTERVAL_MS: 60_000 }));

// ---------- in-memory tables ----------

interface Row {
  contract: string;
  type: string;
  ledger: number;
  txHash: string;
  eventIdx: number;
  data: Record<string, unknown>;
  protocolTs: bigint;
  createdAt: Date;
}
const rows: Row[] = [];
const cursors = new Map<string, number>();
const createMany = vi.fn(async ({ data }: { data: Omit<Row, "createdAt">[] }) => {
  let count = 0;
  for (const r of data) {
    if (rows.some((x) => x.txHash === r.txHash && x.eventIdx === r.eventIdx)) continue;
    rows.push({ ...r, createdAt: new Date() });
    count++;
  }
  return { count };
});
vi.mock("@/lib/db", () => ({
  db: {
    indexerCursor: {
      findUnique: async ({ where }: { where: { id: string } }) => (cursors.has(where.id) ? { id: where.id, lastLedger: cursors.get(where.id)! } : null),
      upsert: async ({ where, update }: { where: { id: string }; update: { lastLedger: number } }) => cursors.set(where.id, update.lastLedger),
    },
    chainEvent: {
      findMany: async ({ where }: { where: { txHash: { in: string[] } } }) => rows.filter((r) => where.txHash.in.includes(r.txHash)),
      findFirst: async ({ where }: { where: { type: string; contract: string; ledger: { lte: number } } }) =>
        rows.filter((r) => r.type === where.type && r.contract === where.contract && r.ledger <= where.ledger.lte).sort((a, b) => b.ledger - a.ledger)[0] ?? null,
      createMany: (args: { data: Omit<Row, "createdAt">[] }) => createMany(args),
    },
  },
}));

const { runSync, syncEvents, syncIfStale } = await import("./sync");

const DAY = 86_400;
const closeOf = (ledger: number) => BASE_CLOSE + (ledger - BASE_LEDGER) * 5;

beforeEach(() => {
  chain.events = [];
  chain.oldest = BASE_LEDGER - 25_000;
  chain.latest = BASE_LEDGER + 100;
  rows.length = 0;
  cursors.clear();
  deployed = true;
  vi.clearAllMocks();
  (globalThis as { advanceIndexer?: unknown }).advanceIndexer = undefined;
  readProtocolNow.mockResolvedValue(BigInt(closeOf(chain.latest) + 2 * DAY));
});

describe("syncEvents", () => {
  it("first pass scans the whole retention window, stores decoded events with protocol times and saves the cursor", async () => {
    chain.events = [
      ev.noteMinted(1, AGENT, 1_500_000n, 20_500, 0x11, { ledger: BASE_LEDGER - 20_000 }),
      ev.lineOpened(1, AGENT, 37_500_000_000n, { ledger: BASE_LEDGER - 20_000, index: 1 }),
      ev.deposit(INVESTOR, 50_000_000_000n, 50_000_000_000n, { ledger: BASE_LEDGER - 5 }),
      ev.transfer(INVESTOR, POOL_ID, 50_000_000_000n, { ledger: BASE_LEDGER - 5, index: 1 }),
      ev.cardDraw(AGENT, 3n, 0n, 3n, new Uint8Array(32), { ledger: BASE_LEDGER + 50 }),
      ev.juniorDeposit(1n, { ledger: BASE_LEDGER + 50, contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" }), // not ours
    ];
    const res = await syncEvents();

    expect(res).toMatchObject({ status: "ok", fromLedger: chain.oldest, toLedger: chain.latest, fetched: 5, inserted: 5, snapshot: true });
    expect(res.pages).toBe(3); // 25,100 ledgers / 10,000 per scan window
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.type)).toEqual(["NoteMinted", "LineOpened", "Deposit", "Transfer", "CardDraw"]);
    // no ClockAdvanced known: protocol time = close time + current offset (2 days)
    expect(rows[0].protocolTs).toBe(BigInt(closeOf(BASE_LEDGER - 20_000) + 2 * DAY));
    expect(rows[2].data).toMatchObject({ receiver: INVESTOR, assets: "50000000000", ledgerClosedAt: new Date(closeOf(BASE_LEDGER - 5) * 1000).toISOString() });
    expect(cursors.get("events:k1")).toBe(chain.latest);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0].map((e) => e.type)).toEqual(["NoteMinted", "LineOpened", "Deposit", "Transfer", "CardDraw"]);
  });

  it("next pass resumes at the cursor and only stores/reconciles new events", async () => {
    chain.events = [ev.juniorDeposit(1n, { ledger: BASE_LEDGER + 100 })];
    await syncEvents();
    expect(rows).toHaveLength(1);

    chain.latest += 50;
    chain.events.push(ev.clockAdvanced(BigInt(30 * DAY), BigInt(closeOf(BASE_LEDGER + 120) + 32 * DAY), { ledger: BASE_LEDGER + 120 }));
    chain.events.push(ev.feesClaimed(5n, { ledger: BASE_LEDGER + 140 }));
    const res = await syncEvents();

    expect(getEvents.mock.calls.at(-1)?.[0]).toMatchObject({ startLedger: BASE_LEDGER + 100 }); // re-scans the last ledger
    expect(res).toMatchObject({ fetched: 3, inserted: 2, pages: 1 });
    expect(reconcile.mock.calls[1][0].map((e) => e.type)).toEqual(["ClockAdvanced", "FeesClaimed"]);
    const [advanced, fees] = rows.slice(1);
    expect(advanced.protocolTs).toBe(BigInt(closeOf(BASE_LEDGER + 120) + 32 * DAY));
    expect(fees.protocolTs).toBe(BigInt(closeOf(BASE_LEDGER + 140) + 32 * DAY));
    expect(readProtocolNow).toHaveBeenCalledTimes(1); // only the first pass needed an estimate
  });

  it("uses the stored ClockAdvanced anchor for later events", async () => {
    chain.events = [ev.clockAdvanced(BigInt(DAY), BigInt(closeOf(BASE_LEDGER) + 5 * DAY), { ledger: BASE_LEDGER })];
    await syncEvents();
    chain.latest += 10;
    chain.events.push(ev.feesClaimed(1n, { ledger: BASE_LEDGER + 105 }));
    await syncEvents();
    expect(rows[1].protocolTs).toBe(BigInt(closeOf(BASE_LEDGER + 105) + 5 * DAY));
    expect(readProtocolNow).not.toHaveBeenCalled();
  });

  it("pages by event cursor when a page is full", async () => {
    chain.events = Array.from({ length: 450 }, (_, i) => ev.feesClaimed(BigInt(i + 1), { ledger: BASE_LEDGER + (i % 50), txOrder: 1 + Math.floor(i / 50) }));
    cursors.set("events:k1", BASE_LEDGER);
    const res = await syncEvents();
    expect(res).toMatchObject({ inserted: 450, pages: 3 });
    expect(new Set(rows.map((r) => r.txHash)).size).toBe(450);
  });

  it("reports a retention gap and restarts at the oldest retained ledger", async () => {
    cursors.set("events:k1", chain.oldest - 500);
    chain.events = [ev.feesClaimed(1n, { ledger: chain.oldest + 1 })];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await syncEvents();
    expect(res.gap).toEqual({ from: chain.oldest - 500, to: chain.oldest - 1 });
    expect(res).toMatchObject({ fromLedger: chain.oldest, inserted: 1 });
    expect(warn).toHaveBeenCalled();
  });

  it("rescans when the cursor is past the chain tip (testnet reset)", async () => {
    cursors.set("events:k1", chain.latest + 1_000_000);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await syncEvents();
    expect(res).toMatchObject({ status: "ok", fromLedger: chain.oldest, toLedger: chain.latest });
    expect(cursors.get("events:k1")).toBe(chain.latest);
  });

  it("backs off snapshots for a minute after a failure and logs it once", async () => {
    recordPoolSnapshot.mockRejectedValue(new Error("Contract C… is not on the network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await syncEvents()).snapshot).toBe(false);
    expect((await syncEvents()).snapshot).toBe(false);
    expect(recordPoolSnapshot).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    recordPoolSnapshot.mockReset();
    recordPoolSnapshot.mockResolvedValue(true);
  });

  it("skips gracefully without a deployment", async () => {
    deployed = false;
    expect(await syncEvents()).toMatchObject({ status: "skipped", reason: "no-deployment", inserted: 0 });
    expect(getEvents).not.toHaveBeenCalled();
  });
});

describe("runSync / syncIfStale", () => {
  it("is single-flight, honours maxAge and never throws", async () => {
    chain.events = [ev.feesClaimed(1n, { ledger: BASE_LEDGER })];
    const [a, b] = await Promise.all([syncIfStale(0), syncIfStale(0)]);
    expect(a).toEqual(b);
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(await syncIfStale(60_000)).toBeNull(); // fresh enough: no RPC call
    expect(getEvents).toHaveBeenCalledTimes(3);

    // a single network blip is retried transparently…
    const hangUp = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    getEvents.mockRejectedValueOnce(hangUp());
    expect(await runSync()).toMatchObject({ status: "ok" });
    // …a persistent failure is reported, never thrown
    getEvents.mockRejectedValueOnce(hangUp()).mockRejectedValueOnce(hangUp()).mockRejectedValueOnce(hangUp());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = await runSync();
    expect(failed).toMatchObject({ status: "error" });
    expect(failed.reason).toContain("socket hang up");
  });

  it("returns null when the pass takes longer than waitMs, and finishes in the background", async () => {
    let release!: () => void;
    getHealth.mockImplementationOnce(() => new Promise((r) => (release = () => r({ status: "healthy", oldestLedger: chain.oldest, latestLedger: chain.latest, ledgerRetentionWindow: 1 }))));
    await new Promise((r) => setTimeout(r, 0));
    const pending = syncIfStale(0, { waitMs: 10 });
    expect(await pending).toBeNull();
    release();
    expect(await runSync()).toMatchObject({ status: "ok" });
  });
});
