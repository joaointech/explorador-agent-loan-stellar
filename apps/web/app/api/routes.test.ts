// Route handlers against a mocked chain layer and an in-memory database:
// every response is checked against a strict schema mirroring lib/types/api.ts.

import { StrKey } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { resetRateLimits } from "@/lib/auth/rate-limit";
import { decodeEvent } from "@/lib/indexer/events";
import { BASE_CLOSE, BASE_LEDGER, ev } from "@/lib/indexer/fixtures";
import { decodeNote, decodePoolStats } from "@/lib/stellar/decode";
import { ContractError } from "@/lib/stellar/errors";
import { AGENT, AGENT_2, INVESTOR, NOTE_ID, POOL_ID, TEURC_ID, noteScVal, poolStatsScVal } from "@/lib/stellar/fixtures";
import { snarkjsToSorobanProof } from "@/lib/stellar/proof";
import type { Note } from "@/lib/types/chain";

// ---------- scenario ----------

const DAY = 86_400;
const NOW = 1_800_000_000; // protocol clock
const today = Math.floor(NOW / DAY);
const EUR = 10_000_000n;

const notes: Note[] = [
  decodeNote(noteScVal({ id: 1, agent: AGENT, escrituraDay: today + 30, status: "Active", commitmentFill: 0x11, mintedAt: BigInt(NOW - 20 * DAY) })),
  decodeNote(noteScVal({ id: 2, agent: AGENT_2, escrituraDay: today - 5, status: "Settled", commitmentFill: 0x12 })),
  decodeNote(noteScVal({ id: 3, agent: AGENT_2, escrituraDay: today + 10, status: "Cancelled", commitmentFill: 0x13 })),
  decodeNote(noteScVal({ id: 4, agent: AGENT, escrituraDay: today - 1, status: "Active", commitmentFill: 0x14 })), // overdue
];

const STORED_PROOF = {
  proof: {
    pi_a: ["11", "22", "1"],
    pi_b: [
      ["31", "32"],
      ["41", "42"],
      ["1", "0"],
    ],
    pi_c: ["51", "52", "1"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["1", "1500000", "750000", String(today + 30), "5", "6", "777", "888", "999"],
};
const PII = "Maria Silva 123456789 Rua das Flores 12";

const L = (n: number) => ({ ledger: BASE_LEDGER + n });
const rawEvents = [
  ev.noteMinted(1, AGENT, 1_500_000n, today + 30, 0x11, L(1)),
  ev.lineOpened(1, AGENT, 3_750n * EUR, { ...L(1), index: 1 }),
  ev.noteMinted(2, AGENT_2, 1_500_000n, today - 5, 0x12, L(2)),
  ev.lineOpened(2, AGENT_2, 3_750n * EUR, { ...L(2), index: 1 }),
  ev.noteMinted(3, AGENT_2, 1_500_000n, today + 10, 0x13, L(3)),
  ev.lineOpened(3, AGENT_2, 3_750n * EUR, { ...L(3), index: 1 }),
  ev.noteMinted(4, AGENT, 1_500_000n, today - 1, 0x14, L(4)),
  ev.lineOpened(4, AGENT, 3_750n * EUR, { ...L(4), index: 1 }),
  ev.cardDraw(AGENT, 1_000n * EUR, 0n, 1_000n * EUR, new Uint8Array(32).fill(1), L(10)),
  ev.cardDraw(AGENT, 500n * EUR, 100n * EUR, 400n * EUR, new Uint8Array(32).fill(2), L(11)),
  ev.noteSettled(2, AGENT_2, { total: 15_000n * EUR, debtRepaid: 0n, interestPaid: 0n, agentPayout: 7_500n * EUR, juniorDeposit: 7_500n * EUR }, L(12)),
  // after note 2 settled, Bruno's only open line is note 3
  ev.cardDraw(AGENT_2, 2_000n * EUR, 0n, 2_000n * EUR, new Uint8Array(32).fill(3), L(13)),
  ev.noteCancelled(3, AGENT_2, 2_000n * EUR, BigInt(NOW + 180 * DAY), L(14)),
  ev.clockAdvanced(BigInt(180 * DAY), BigInt(NOW), L(15)),
  ev.debtWrittenOff(AGENT_2, 2_000n * EUR, 2_000n * EUR, 0n, L(16)),
  ev.deposit(INVESTOR, 50_000n * EUR, 50_000n * EUR, L(20)),
  ev.withdraw(INVESTOR, 10_000n * EUR, 9_900n * EUR, L(21)),
  ev.transfer(INVESTOR, POOL_ID, 50_000n * EUR, { ...L(20), index: 1 }),
];

// ---------- in-memory db ----------

type Row = Record<string, unknown>;
const ANY_NULL = Symbol("AnyNull");
const tables: Record<string, Row[]> = { chainEvent: [], poolSnapshot: [], cpcv: [] };

const getPath = (obj: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], obj);
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Row[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("path" in c) return getPath(value, c.path as string[]) === c.equals;
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
      if ("lte" in c && !((value as bigint) <= (c.lte as bigint))) return false;
      if ("gte" in c && !((value as bigint) >= (c.gte as bigint))) return false;
      if ("not" in c && (c.not === ANY_NULL ? value === null || value === undefined : value === c.not)) return false;
      return true;
    }
    return value === cond;
  });
}
function query(table: string, args: { where?: Row; orderBy?: Row | Row[]; select?: Record<string, boolean>; take?: number } = {}) {
  let rows = tables[table].filter((r) => matches(r, args.where));
  const order = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : [];
  rows = [...rows].sort((a, b) => {
    for (const o of order) {
      const [k, dir] = Object.entries(o)[0];
      const av = a[k] as number | bigint | Date;
      const bv = b[k] as number | bigint | Date;
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
  if (args.take) rows = rows.slice(0, args.take);
  if (args.select) rows = rows.map((r) => Object.fromEntries(Object.keys(args.select!).map((k) => [k, r[k]])));
  return rows;
}
const model = (table: string) => ({
  findMany: async (args?: Row) => query(table, args as never),
  findFirst: async (args?: Row) => query(table, args as never)[0] ?? null,
});
vi.mock("@/lib/db", () => ({
  Prisma: { AnyNull: ANY_NULL },
  db: {
    chainEvent: model("chainEvent"),
    poolSnapshot: model("poolSnapshot"),
    cpcv: model("cpcv"),
    $queryRaw: async (_s: TemplateStringsArray, type: string, contract: string) => {
      const total = tables.chainEvent
        .filter((r) => r.type === type && r.contract === contract)
        .reduce((sum, r) => sum + BigInt((r.data as Row).fromCredit as string), 0n);
      return [{ total: total.toString() }];
    },
  },
}));

// ---------- mocked chain layer ----------

let deployed = true;
const deployment = () => ({
  key: "k",
  source: "db",
  createdAt: new Date(0),
  wasmHashes: {},
  info: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    teurc: TEURC_ID,
    cpcvNote: NOTE_ID,
    advancePool: POOL_ID,
    explorerBase: "https://stellar.expert/explorer/testnet",
  },
});
vi.mock("@/lib/stellar/deployment", async () => {
  const { NotDeployedError } = await import("@/lib/stellar/errors");
  return {
    resolveDeployment: async () => (deployed ? deployment() : null),
    requireDeployment: async () => {
      if (!deployed) throw new NotDeployedError();
      return deployment();
    },
  };
});

const chain = {
  stats: decodePoolStats(poolStatsScVal({ protocolNow: BigInt(NOW), sharePriceScaled: 1_010_000_000_000_000_000n })),
  faucet: vi.fn(async () => ({ txHash: "f".repeat(64), ledger: 1, result: undefined })),
};
vi.mock("@/lib/stellar/contracts", () => ({
  MAX_LIST_LIMIT: 50,
  getDeployment: async () => (deployed ? deployment().info : null),
  readPoolStats: async () => chain.stats,
  readNoteCount: async () => notes.length,
  readNotes: async (start: number, limit: number) => notes.filter((n) => n.id >= start && n.id < start + limit),
  readNote: async (id: number) => {
    const n = notes.find((x) => x.id === id);
    if (!n) throw new ContractError(18, "get");
    return n;
  },
  readLine: async (id: number) => ({ line: { noteId: id, principal: 1_400n * EUR }, debt: 0n, interest: 0n, available: 0n }),
  readShareBalance: async () => 40_100n * EUR,
  readMaxWithdraw: async () => 40_000n * EUR,
  faucetTeurc: (...args: unknown[]) => chain.faucet(...(args as [])),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));

const runSync = vi.fn(async () => ({ status: "ok", pages: 1, fetched: 0, inserted: 0, snapshot: false, durationMs: 5 }));
vi.mock("@/lib/indexer/sync", () => ({ syncIfStale: async () => null, runSync: () => runSync() }));

// ---------- response schemas (lib/types/api.ts) ----------

const stroops = z.string().regex(/^-?\d+$/);
const error = z.strictObject({ error: z.strictObject({ code: z.string(), message: z.string() }) });
const status = z.enum(["Active", "Settled", "Cancelled", "WrittenOff"]);
const counts = z.strictObject({ Active: z.number(), Settled: z.number(), Cancelled: z.number(), WrittenOff: z.number(), total: z.number() });
const deploymentInfo = z.strictObject({
  network: z.literal("testnet"),
  rpcUrl: z.string(),
  networkPassphrase: z.string(),
  teurc: z.string(),
  cpcvNote: z.string(),
  advancePool: z.string(),
  explorerBase: z.string(),
});
const poolParams = z.strictObject({
  agentAprBps: z.number(),
  protocolFeeBps: z.number(),
  seniorTargetBps: z.number(),
  ltvBps: z.number(),
  gracePeriodSecs: stroops,
  maxLeverage: z.number(),
  demoMode: z.boolean(),
});
const poolStats = z.strictObject({
  seniorAssets: stroops,
  juniorAssets: stroops,
  feesAccrued: stroops,
  totalDebt: stroops,
  totalPrincipal: stroops,
  poolCash: stroops,
  totalCardBalances: stroops,
  shareSupply: stroops,
  sharePriceScaled: stroops,
  utilizationBps: z.number(),
  leverageX100: z.number(),
  lendable: stroops,
  leverageHeadroom: stroops,
  borrowIndex: stroops,
  protocolNow: stroops,
  params: poolParams,
  writtenOffTotal: stroops,
});
const registryNote = z.strictObject({
  id: z.number(),
  agent: z.string(),
  totalCommission: stroops,
  agentCommission: stroops,
  exploradorCommission: stroops,
  creditLimit: stroops,
  escrituraDay: z.number(),
  status,
  overdue: z.boolean(),
  mintedAt: z.number(),
  mintTxHash: z.string().nullable(),
});
const schemas = {
  config: z.strictObject({ deployment: deploymentInfo.nullable(), demoMode: z.boolean(), lithicEnabled: z.boolean() }),
  poolStats: z.strictObject({
    stats: poolStats,
    apy: z.strictObject({ target: z.number(), projectedSenior: z.number(), projectedJunior: z.number(), trailing7dSenior: z.number().nullable() }),
    notes: counts,
    totalAdvanced: stroops,
    clock: z.strictObject({ protocolNow: z.number(), offsetSecs: z.number(), demoMode: z.boolean() }),
  }),
  snapshots: z.strictObject({
    range: z.string(),
    points: z.array(z.strictObject({ t: z.number(), sharePrice: z.number(), tvl: stroops, debt: stroops, seniorAssets: stroops, juniorAssets: stroops })),
  }),
  registryList: z.strictObject({ notes: z.array(registryNote), nextCursor: z.string().nullable(), counts }),
  registryDetail: z.strictObject({
    note: registryNote.extend({ commitment: z.string(), nullifier: z.string(), proof: z.strictObject({ a: z.string(), b: z.string(), c: z.string() }) }),
    publicSignals: z.array(z.string()),
    snarkjsProof: z
      .strictObject({
        pi_a: z.array(z.string()),
        pi_b: z.array(z.array(z.string())),
        pi_c: z.array(z.string()),
        protocol: z.literal("groth16"),
        curve: z.literal("bn128"),
      })
      .nullable(),
    draws: z.strictObject({ count: z.number(), total: stroops }),
    timeline: z.array(z.strictObject({ type: z.string(), at: z.number().nullable(), ledger: z.number(), txHash: z.string(), data: z.record(z.string(), z.unknown()) })),
    hidden: z.array(z.string()),
  }),
  investor: z.strictObject({
    address: z.string(),
    shares: stroops,
    value: stroops,
    deposited: stroops,
    withdrawn: stroops,
    earned: stroops,
    sharePriceScaled: stroops,
    maxWithdraw: stroops,
    history: z.array(z.strictObject({ type: z.enum(["deposit", "withdraw"]), assets: stroops, shares: stroops, txHash: z.string(), at: z.number() })),
  }),
  tx: z.strictObject({ txHash: z.string(), explorerUrl: z.string() }),
};

// ---------- helpers ----------

const { GET: configGET } = await import("./config/route");
const { GET: statsGET } = await import("./pool/stats/route");
const { GET: snapshotsGET } = await import("./pool/snapshots/route");
const { GET: registryGET } = await import("./registry/route");
const { GET: detailGET } = await import("./registry/[id]/route");
const { GET: metadataGET } = await import("./registry/[id]/metadata/route");
const { GET: noteUriGET } = await import("./notes/[id]/route");
const { GET: investorGET } = await import("./investor/[address]/route");
const { POST: faucetPOST } = await import("./faucet/teurc/route");
const { GET: cronGET } = await import("./cron/sync/route");

const { NextRequest } = await import("next/server");
const get = (path: string) => new NextRequest(`http://localhost:3105${path}`);
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
async function body<T>(res: Response, schema: z.ZodType<T>, expectedStatus = 200): Promise<T> {
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(expectedStatus);
  return schema.parse(json);
}

beforeEach(() => {
  deployed = true;
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).advanceNotes = undefined;
  (globalThis as Record<string, unknown>).advanceStats = undefined;
  (globalThis as Record<string, unknown>).teurcFaucet = undefined;
  tables.chainEvent = rawEvents.map((raw) => {
    const e = decodeEvent(raw)!;
    return {
      contract: e.contract,
      type: e.type,
      ledger: e.ledger,
      txHash: e.txHash,
      eventIdx: e.eventIdx,
      data: { ...e.data, ledgerClosedAt: new Date(e.closedAt * 1000).toISOString() },
      protocolTs: BigInt(e.closedAt - BASE_CLOSE + NOW - 30 * DAY),
      createdAt: new Date(),
    };
  });
  tables.poolSnapshot = [0, 3, 6, 9, 10, 10].map((d, i) => ({
    protocolTs: BigInt(NOW - 10 * DAY + d * DAY),
    seniorAssets: 100_000n * EUR,
    juniorAssets: 10_000n * EUR,
    feesAccrued: 0n,
    totalDebt: 60_000n * EUR,
    poolCash: 50_000n * EUR,
    sharePrice: String(1_000_000_000_000_000_000n + BigInt(d) * 1_000_000_000_000_000n),
    shareSupply: 95_000n * EUR,
    createdAt: new Date(Date.now() - (6 - i) * 60_000),
  }));
  tables.cpcv = [
    { noteId: 1, status: "MINTED", mintTxHash: "aa".repeat(32), commitment: "11".repeat(32), proof: STORED_PROOF, piiEncrypted: PII, createdAt: new Date(1) },
    // stale row from an older deployment: same note id, different commitment
    { noteId: 2, status: "MINTED", mintTxHash: "bb".repeat(32), commitment: "99".repeat(32), proof: null, piiEncrypted: PII, createdAt: new Date(0) },
  ];
});

// ---------- tests ----------

describe("GET /api/config", () => {
  it("returns the deployment and flags", async () => {
    const res = await body(await configGET(), schemas.config);
    expect(res.deployment?.advancePool).toBe(POOL_ID);
    expect(res.demoMode).toBe(true);
    expect(res.lithicEnabled).toBe(false);
  });
  it("returns deployment null before a deploy", async () => {
    deployed = false;
    expect((await body(await configGET(), schemas.config)).deployment).toBeNull();
  });
});

describe("GET /api/pool/stats", () => {
  it("combines stats, APY, note counts, total advanced and the demo clock", async () => {
    const res = await body(await statsGET(), schemas.poolStats);
    expect(res.stats.juniorAssets).toBe("100000000000");
    expect(res.apy.target).toBe(0.08);
    expect(res.apy.projectedSenior).toBeCloseTo(0.0648, 8); // §5.6: debt €60k on €100k senior
    expect(res.apy.projectedJunior).toBe(0);
    expect(res.apy.trailing7dSenior).not.toBeNull();
    expect(res.notes).toEqual({ Active: 2, Settled: 1, Cancelled: 0, WrittenOff: 1, total: 4 });
    expect(res.totalAdvanced).toBe((3_400n * EUR).toString()); // 1,000 + 400 + 2,000 from credit
    expect(res.clock.protocolNow).toBe(NOW);
  });
  it("answers 503 NOT_DEPLOYED without a deployment", async () => {
    deployed = false;
    const res = await body(await statsGET(), error, 503);
    expect(res.error.code).toBe("NOT_DEPLOYED");
  });
});

describe("GET /api/pool/snapshots", () => {
  it("returns the 7-protocol-day window, one point per timestamp", async () => {
    const res = await body(await snapshotsGET(get("/api/pool/snapshots?range=7d")), schemas.snapshots);
    expect(res.range).toBe("7d");
    expect(res.points.map((p) => (p.t - (NOW - 10 * DAY)) / DAY)).toEqual([3, 6, 9, 10]);
    expect(res.points[0]).toMatchObject({ sharePrice: 1.003, tvl: (110_000n * EUR).toString(), debt: (60_000n * EUR).toString() });
    const all = await body(await snapshotsGET(get("/api/pool/snapshots?range=all")), schemas.snapshots);
    expect(all.points).toHaveLength(5);
  });
  it("rejects an unknown range and returns no points without a deployment", async () => {
    expect((await body(await snapshotsGET(get("/api/pool/snapshots?range=1y")), error, 400)).error.code).toBe("VALIDATION_ERROR");
    deployed = false;
    expect((await body(await snapshotsGET(get("/api/pool/snapshots")), schemas.snapshots)).points).toEqual([]);
  });
});

describe("GET /api/registry", () => {
  it("lists notes newest first with registry statuses, credit limits, overdue flags and mint txs", async () => {
    const res = await body(await registryGET(get("/api/registry")), schemas.registryList);
    expect(res.notes.map((n) => [n.id, n.status, n.overdue])).toEqual([
      [4, "Active", true],
      [3, "WrittenOff", false],
      [2, "Settled", false],
      [1, "Active", false],
    ]);
    expect(res.notes[3]).toMatchObject({ creditLimit: (3_750n * EUR).toString(), agent: AGENT, mintTxHash: tables.chainEvent[0].txHash });
    expect(res.counts).toEqual({ Active: 2, Settled: 1, Cancelled: 0, WrittenOff: 1, total: 4 });
    expect(res.nextCursor).toBeNull();
  });

  it("filters by status, searches by id or (truncated) address and paginates", async () => {
    const off = await body(await registryGET(get("/api/registry?status=written-off")), schemas.registryList);
    expect(off.notes.map((n) => n.id)).toEqual([3]);
    const byId = await body(await registryGET(get("/api/registry?q=%232")), schemas.registryList);
    expect(byId.notes.map((n) => n.id)).toEqual([2]);
    const truncated = `${AGENT.slice(0, 4)}…${AGENT.slice(-4)}`;
    const byAgent = await body(await registryGET(get(`/api/registry?q=${encodeURIComponent(truncated)}`)), schemas.registryList);
    expect(byAgent.notes.map((n) => n.id)).toEqual([4, 1]);

    const page1 = await body(await registryGET(get("/api/registry?limit=3")), schemas.registryList);
    expect(page1.notes.map((n) => n.id)).toEqual([4, 3, 2]);
    expect(page1.nextCursor).toBe("2");
    const page2 = await body(await registryGET(get(`/api/registry?limit=3&cursor=${page1.nextCursor}`)), schemas.registryList);
    expect(page2.notes.map((n) => n.id)).toEqual([1]);
    expect(page2.nextCursor).toBeNull();
  });

  it("validates query parameters", async () => {
    expect((await body(await registryGET(get("/api/registry?status=paused")), error, 400)).error.code).toBe("VALIDATION_ERROR");
    expect((await body(await registryGET(get("/api/registry?limit=0")), error, 400)).error.code).toBe("VALIDATION_ERROR");
  });

  it("is an empty registry before a deploy", async () => {
    deployed = false;
    expect(await body(await registryGET(get("/api/registry")), schemas.registryList)).toEqual({
      notes: [],
      nextCursor: null,
      counts: { Active: 0, Settled: 0, Cancelled: 0, WrittenOff: 0, total: 0 },
    });
  });
});

describe("GET /api/registry/[id]", () => {
  it("returns public fields, the stored snarkjs proof + signals, draws and a timeline — and no PII", async () => {
    const res = await detailGET(get("/api/registry/1"), params({ id: "1" }));
    const text = await res.clone().text();
    const detail = await body(res, schemas.registryDetail);
    expect(detail.note).toMatchObject({ id: 1, status: "Active", commitment: "11".repeat(32), proof: { a: "aa".repeat(64) } });
    expect(detail.snarkjsProof).toEqual(STORED_PROOF.proof);
    expect(detail.publicSignals).toEqual(STORED_PROOF.publicSignals);
    // Ana's draws went to note 4 (earlier escritura), so note 1's timeline has no CardDraw
    expect(detail.timeline.map((t) => t.type)).toEqual(["NoteMinted", "LineOpened"]);
    expect(detail.timeline[0].at).toBe(Number(tables.chainEvent[0].protocolTs));
    expect(detail.draws.total).toBe((1_400n * EUR).toString()); // active line: principal read on-chain
    expect(detail.hidden).toContain("Buyer NIF");
    expect(text).not.toContain("Maria");
    expect(text).not.toContain("piiEncrypted");
  });

  it("attributes draws to the line with the earliest escritura first", async () => {
    // note 4 (escritura today − 1) sorts before note 1 (today + 30): both Ana draws (1,000 + 400) fit its €3,750 limit
    const four = await body(await detailGET(get("/api/registry/4"), params({ id: "4" })), schemas.registryDetail);
    expect(four.draws.count).toBe(2);
    expect(four.timeline.filter((t) => t.type === "CardDraw").map((t) => t.data.attributedToNote)).toEqual([(1_000n * EUR).toString(), (400n * EUR).toString()]);
    const one = await body(await detailGET(get("/api/registry/1"), params({ id: "1" })), schemas.registryDetail);
    expect(one.draws.count).toBe(0);
  });

  it("ignores a stale Cpcv row: derives the snarkjs proof from chain bytes and rebuilds the signals", async () => {
    const res = await body(await detailGET(get("/api/registry/2"), params({ id: "2" })), schemas.registryDetail);
    expect(res.snarkjsProof).not.toBeNull();
    expect(snarkjsToSorobanProof(res.snarkjsProof!)).toEqual(notes[1].proof);
    expect(res.publicSignals).toHaveLength(9);
    expect(res.publicSignals.slice(1, 4)).toEqual(["1500000", "750000", String(today - 5)]);
    expect(res.publicSignals.slice(6)).toEqual(["777", "888", "999"]);
    expect(res.note.mintTxHash).toBe(tables.chainEvent[2].txHash);
    expect(res.draws.total).toBe("0"); // settled: debt_repaid − interest_paid
  });

  it("shows the write-off in the timeline of a written-off note", async () => {
    const res = await body(await detailGET(get("/api/registry/3"), params({ id: "3" })), schemas.registryDetail);
    expect(res.note.status).toBe("WrittenOff");
    expect(res.timeline.map((t) => t.type)).toEqual(["NoteMinted", "LineOpened", "CardDraw", "NoteCancelled", "DebtWrittenOff"]);
    expect(res.timeline.every((t) => typeof t.at === "number")).toBe(true);
  });

  it("404s an unknown note and 400s a malformed id", async () => {
    expect((await body(await detailGET(get("/api/registry/999"), params({ id: "999" })), error, 404)).error.code).toBe("UNKNOWN_NOTE");
    expect((await body(await detailGET(get("/api/registry/abc"), params({ id: "abc" })), error, 400)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/registry/[id]/metadata", () => {
  it("returns SEP-50 metadata without personal data", async () => {
    const res = await metadataGET(get("/api/registry/1/metadata"), params({ id: "1" }));
    const meta = z
      .strictObject({
        name: z.string(),
        description: z.string(),
        image: z.string(),
        external_url: z.string(),
        attributes: z.array(z.strictObject({ trait_type: z.string(), value: z.union([z.string(), z.number()]), display_type: z.enum(["number", "date"]).optional() })),
      })
      .parse(await res.json());
    expect(meta.name).toBe("explorador advance CPCV Note #1");
    expect(meta.external_url).toBe("http://localhost:3000/registry/1");
    const attr = Object.fromEntries(meta.attributes.map((a) => [a.trait_type, a.value]));
    expect(attr).toMatchObject({ Status: "Active", Agent: AGENT, "Total commission (EUR)": 15_000, "Credit limit (EUR)": 3_750 });
    expect(JSON.stringify(meta)).not.toContain("Maria");
  });
});

describe("GET /api/notes/[id] (token_uri = base_uri + \"/\" + id)", () => {
  it("serves the same SEP-50 metadata as /api/registry/[id]/metadata", async () => {
    const alias = await noteUriGET(get("/api/notes/1"), params({ id: "1" }));
    expect(alias.status).toBe(200);
    const canonical = await metadataGET(get("/api/registry/1/metadata"), params({ id: "1" }));
    expect(await alias.json()).toEqual(await canonical.json());
    expect((await body(await noteUriGET(get("/api/notes/x"), params({ id: "x" })), error, 400)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/investor/[address]", () => {
  it("returns shares, value, max withdraw and deposit/withdraw history", async () => {
    const res = await body(await investorGET(get(`/api/investor/${INVESTOR}`), params({ address: INVESTOR })), schemas.investor);
    expect(res).toMatchObject({ address: INVESTOR, shares: (40_100n * EUR).toString(), deposited: (50_000n * EUR).toString(), withdrawn: (10_000n * EUR).toString(), maxWithdraw: (40_000n * EUR).toString() });
    expect(res.history.map((h) => h.type)).toEqual(["withdraw", "deposit"]);
    // value = shares × (senior + 1) / (supply + 1); earned = value + withdrawn − deposited
    const value = (40_100n * EUR * (100_000n * EUR + 1n)) / (95_000n * EUR + 1n);
    expect(res.value).toBe(value.toString());
    expect(res.earned).toBe((value + 10_000n * EUR - 50_000n * EUR).toString());
  });
  it("rejects a malformed address", async () => {
    expect((await body(await investorGET(get("/api/investor/nope"), params({ address: "nope" })), error, 400)).error.code).toBe("INVALID_ADDRESS");
  });
});

describe("POST /api/faucet/teurc", () => {
  const post = (b: unknown) => new Request("http://localhost:3105/api/faucet/teurc", { method: "POST", body: JSON.stringify(b) });
  it("sends 10,000 tEURC and rate-limits the address", async () => {
    const res = await body(await faucetPOST(post({ address: INVESTOR })), schemas.tx);
    expect(res).toEqual({ txHash: "f".repeat(64), explorerUrl: `https://stellar.expert/explorer/testnet/tx/${"f".repeat(64)}` });
    expect(chain.faucet).toHaveBeenCalledWith(INVESTOR, 10_000n * EUR);
    expect((await body(await faucetPOST(post({ address: INVESTOR })), error, 429)).error.code).toBe("RATE_LIMITED");
  });
  it("validates the body", async () => {
    expect((await body(await faucetPOST(post({ address: "GABC" })), error, 400)).error.code).toBe("VALIDATION_ERROR");
    expect(chain.faucet).not.toHaveBeenCalled();
  });
  it("limits fresh addresses per client IP and per instance, so a flood can't queue the operator", async () => {
    resetRateLimits();
    const fresh = (i: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 100 + i));
    const from = (ip: string, address: string) =>
      new Request("http://localhost:3105/api/faucet/teurc", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ address }) });
    try {
      // One IP rotating addresses: 5 grants per 10 minutes.
      for (let i = 0; i < 5; i++) await body(await faucetPOST(from("203.0.113.1", fresh(i))), schemas.tx);
      expect((await body(await faucetPOST(from("203.0.113.1", fresh(5))), error, 429)).error.code).toBe("RATE_LIMITED");
      expect(chain.faucet).toHaveBeenCalledTimes(5);

      // Many IPs: at most 20 grants per minute per instance in total.
      for (let i = 0; i < 15; i++) await body(await faucetPOST(from(`198.51.100.${i}`, fresh(10 + i))), schemas.tx);
      expect((await body(await faucetPOST(from("198.51.100.200", fresh(40))), error, 429)).error.code).toBe("RATE_LIMITED");
      expect(chain.faucet).toHaveBeenCalledTimes(20);
    } finally {
      resetRateLimits();
    }
  });
});

describe("GET /api/cron/sync", () => {
  it("runs one pass and reports failures as 502", async () => {
    expect(await (await cronGET()).json()).toMatchObject({ status: "ok" });
    runSync.mockResolvedValueOnce({ status: "error", reason: "RPC down", pages: 0, fetched: 0, inserted: 0, snapshot: false, durationMs: 1 } as never);
    expect((await body(await cronGET(), error, 502)).error).toEqual({ code: "SYNC_FAILED", message: "RPC down" });
  });
});
