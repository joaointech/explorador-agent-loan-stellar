// Agent overview against the test database (TEST_DATABASE_URL), chain reads
// mocked: onboarding flags, live position + cache refresh, deals, activity
// merge, the cached-position fallback and the route's JSON.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({
  readAgentPosition: vi.fn(),
  readPoolStats: vi.fn(),
  getDeployment: vi.fn(),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));
vi.mock("@/lib/stellar/contracts", () => chain);

const session = vi.hoisted(() => ({ requireAgent: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

import { GET } from "@/app/api/agent/overview/route";
import { db } from "@/lib/db";
import { HttpError, unauthorized } from "@/lib/http";
import { jsonify } from "@/lib/json";
import type { AgentOverviewResponse } from "@/lib/types/api";
import type { AgentPosition, LineView, PoolStats } from "@/lib/types/chain";

import { loadAgentOverview } from "./overview";

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const DOMAIN = "agent-overview-tests.invalid";
const TX = "agent-overview-test-";
const EUR = 10_000_000n;
const SCALE = 10n ** 18n;
const PROTOCOL_NOW = 1_800_000_000; // 2027-01-15 08:00 UTC
const PROTOCOL_DAY = Math.floor(PROTOCOL_NOW / 86_400);
const NOW_MS = Date.UTC(2026, 9, 25, 12, 0, 0);

function stats(over: Partial<PoolStats> = {}): PoolStats {
  return {
    seniorAssets: 100_000n * EUR,
    juniorAssets: 10_000n * EUR,
    feesAccrued: 0n,
    totalDebt: 0n,
    totalPrincipal: 0n,
    poolCash: 110_000n * EUR,
    totalCardBalances: 0n,
    shareSupply: 100_000n * EUR,
    sharePriceScaled: SCALE,
    utilizationBps: 0,
    leverageX100: 0,
    lendable: 110_000n * EUR,
    leverageHeadroom: 100_000n * EUR,
    borrowIndex: 1_012_345_678_901_234_567n,
    protocolNow: BigInt(PROTOCOL_NOW),
    params: { agentAprBps: 1200, protocolFeeBps: 1000, seniorTargetBps: 800, ltvBps: 5000, gracePeriodSecs: 15_552_000n, maxLeverage: 10, demoMode: true },
    writtenOffTotal: 0n,
    ...over,
  };
}

function line(agent: string, noteId: number, escrituraDay: number, principal: bigint, debt: bigint, creditLimit = 3_750n * EUR): LineView {
  return { line: { noteId, agent, creditLimit, principal, scaledDebt: debt, escrituraDay, status: "Active" }, debt, interest: debt - principal, available: creditLimit - debt };
}

function position(lines: LineView[], over: Partial<AgentPosition> = {}): AgentPosition {
  const available = lines.reduce((s, l) => s + l.available, 0n);
  return {
    cardBalance: 0n,
    cardEnabled: true,
    blocked: false,
    lines,
    carriedDebt: 0n,
    graceDeadline: null,
    totalDebt: lines.reduce((s, l) => s + l.debt, 0n),
    totalPrincipal: lines.reduce((s, l) => s + l.line.principal, 0n),
    availableCredit: available,
    borrowableNow: available,
    ...over,
  };
}

async function createUser(over: { passkey?: boolean; agent?: boolean; card?: boolean; cardEnabledOnChain?: boolean; signerKind?: string; cachedPosition?: object; cachedAt?: Date } = {}) {
  const id = randomUUID();
  const user = await db.user.create({ data: { email: `agent-${id}@${DOMAIN}`, role: "AGENT", displayName: over.agent === false ? null : "Ana Costa" } });
  if (over.passkey ?? true) {
    await db.passkey.create({
      data: { userId: user.id, credentialId: `cred-${id}`, publicKeyCose: Buffer.from([1]), publicKeyP256: Buffer.alloc(65, 4), counter: 0, transports: ["internal"] },
    });
  }
  if (over.agent === false) return { user, smartAccount: null as string | null };
  const smartAccount = `C${id.replace(/-/g, "").toUpperCase()}TEST`;
  await db.agent.create({
    data: {
      userId: user.id,
      smartAccount,
      agentField: "00".repeat(32),
      lithicCardToken: over.card === false ? null : `sim_card_${id}`,
      cardLast4: over.card === false ? null : "4242",
      cardEnabledOnChain: over.cardEnabledOnChain ?? false,
      signerKind: over.signerKind ?? "passkey",
      cachedPosition: over.cachedPosition ?? undefined,
      cachedAt: over.cachedAt,
    },
  });
  return { user, smartAccount };
}

async function createCpcv(agentId: string, noteId: number, over: { status?: "MINTED" | "SETTLED" | "CANCELLED"; escrituraDay?: number; agentCommissionCents?: bigint } = {}) {
  const agentCommissionCents = over.agentCommissionCents ?? 750_000n;
  return db.cpcv.create({
    data: {
      agentId,
      piiEncrypted: Buffer.from("encrypted"),
      totalCommissionCents: agentCommissionCents * 2n,
      agentCommissionCents,
      escrituraDay: over.escrituraDay ?? PROTOCOL_DAY + 45,
      commitment: randomUUID(),
      nullifier: randomUUID(),
      status: over.status ?? "MINTED",
      noteId,
      mintTxHash: `${TX}mint-${noteId}`,
    },
  });
}

async function createEvent(type: string, data: Record<string, unknown>, ledger: number, eventIdx = 0) {
  return db.chainEvent.create({ data: { contract: "CPOOL", type, ledger, txHash: `${TX}${randomUUID()}`, eventIdx, data: data as object } });
}

async function createAuthorization(agentId: string, over: { merchant?: string; amountCents?: bigint; decision?: "APPROVED" | "DECLINED"; chainStatus?: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED"; createdAt?: Date; declineReason?: string } = {}) {
  const decision = over.decision ?? "APPROVED";
  const chainStatus = over.chainStatus ?? "CONFIRMED";
  const amountCents = over.amountCents ?? 480n;
  return db.cardAuthorization.create({
    data: {
      lithicToken: `sim_txn_${randomUUID()}`,
      agentId,
      amountCents,
      merchant: over.merchant ?? "Pastelaria Aloma",
      decision,
      declineReason: over.declineReason ?? null,
      chainStatus,
      fromBalanceStroops: chainStatus === "CONFIRMED" ? 0n : null,
      fromCreditStroops: chainStatus === "CONFIRMED" ? amountCents * 100_000n : null,
      txHash: chainStatus === "CONFIRMED" ? `${TX}draw-${randomUUID()}` : null,
      createdAt: over.createdAt,
    },
  });
}

// Note ids are unique across the table: give each test run its own range.
let nextNoteId = 900_000 + Math.floor(Math.random() * 90_000) * 10;
const noteId = () => nextNoteId++;

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.cardAuthorization.deleteMany({ where: { agentId: { in: ids } } });
  await db.cpcv.deleteMany({ where: { agentId: { in: ids } } });
  await db.agent.deleteMany({ where: { userId: { in: ids } } });
  await db.passkey.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.chainEvent.deleteMany({ where: { txHash: { startsWith: TX } } });
}

const opts = { now: () => NOW_MS, readTimeoutMs: 500 };
const notImplemented = () => new HttpError(501, "NOT_IMPLEMENTED", "readAgentPosition is not implemented yet (stellar service workstream)");

describe.skipIf(!hasTestDb)("agent overview (test database)", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  beforeEach(() => {
    chain.readAgentPosition.mockReset().mockResolvedValue(position([]));
    chain.readPoolStats.mockReset().mockResolvedValue(stats());
    chain.getDeployment.mockReset().mockRejectedValue(new HttpError(501, "NOT_IMPLEMENTED", "getDeployment"));
    session.requireAgent.mockReset();
  });

  it("new agent before the passkey: onboarding only, no chain reads", async () => {
    const { user } = await createUser({ passkey: false, agent: false });
    const o = await loadAgentOverview(user.id, opts);
    expect(o.onboarding).toEqual({ passkey: false, smartAccount: false, card: false, cardActivated: false });
    expect(o.agent).toEqual({ smartAccount: null, cardLast4: null, cardEnabledOnChain: false, signerKind: "passkey", cardNetwork: null, cardPaused: false });
    expect(o).toMatchObject({ position: null, positionSource: "none", deals: [], activity: [], pendingHolds: "0" });
    expect(o.rates).toEqual({ agentAprBps: 1200, borrowIndex: SCALE.toString(), protocolNow: NOW_MS / 1000, fetchedAtMs: NOW_MS, live: false });
    expect(o.user.passkeys).toEqual([]);
    expect(chain.readAgentPosition).not.toHaveBeenCalled();
  });

  it("passkey saved but provisioning failed: passkey done, smart account missing", async () => {
    const { user } = await createUser({ agent: false });
    const o = await loadAgentOverview(user.id, opts);
    expect(o.onboarding).toEqual({ passkey: true, smartAccount: false, card: false, cardActivated: false });
    expect(o.user.passkeys).toHaveLength(1);
    expect(o.user.passkeys![0].signer).toBe(false);
  });

  it("card created, not yet activated", async () => {
    const { user, smartAccount } = await createUser({ cardEnabledOnChain: false });
    chain.readAgentPosition.mockResolvedValue(position([], { cardEnabled: false }));
    const o = await loadAgentOverview(user.id, opts);
    expect(chain.readAgentPosition).toHaveBeenCalledWith(smartAccount, { timeoutMs: 500 });
    expect(o.onboarding).toEqual({ passkey: true, smartAccount: true, card: true, cardActivated: false });
    expect(o.agent).toMatchObject({ smartAccount, cardLast4: "4242", cardEnabledOnChain: false, cardNetwork: "simulated", cardPaused: false, signerKind: "passkey" });
    expect(o.user.passkeys![0].signer).toBe(true);
  });

  it("assembles the live position, rates, deals and activity, and refreshes the cache", async () => {
    const { user, smartAccount } = await createUser({ cardEnabledOnChain: false });
    const sa = smartAccount!;
    const [n12, n9, n14, n7] = [noteId(), noteId(), noteId(), noteId()];
    const live = position(
      [line(sa, n7, PROTOCOL_DAY - 3, 500n * EUR, 512n * EUR, 1_000n * EUR), line(sa, n12, PROTOCOL_DAY + 45, 2_600n * EUR, 262_518_000_000n)],
      { cardBalance: 120n * EUR },
    );
    chain.readAgentPosition.mockResolvedValue(live);

    await createCpcv(user.id, n12);
    await createCpcv(user.id, n9, { status: "SETTLED", escrituraDay: PROTOCOL_DAY - 20 });
    await createCpcv(user.id, n14); // Postgres still says MINTED; the indexed event says cancelled
    await createCpcv(user.id, n7, { escrituraDay: PROTOCOL_DAY - 3, agentCommissionCents: 200_000n });

    await createEvent("NoteSettled", { noteId: n9, agent: sa, agentPayout: "44112300000", debtRepaid: "30887700000", ledgerClosedAt: "2026-10-24T10:00:00.000Z" }, 100);
    await createEvent("note_cancelled", { note_id: n14, agent: sa, debt_carried: "20000000000", grace_deadline: "1815552000", ledgerClosedAt: "2026-10-23T10:00:00.000Z" }, 110);
    await createEvent("BalanceWithdrawn", { agent: sa, amount: "5000000000", to: sa, ledgerClosedAt: "2026-10-25T11:30:00.000Z" }, 120);
    await createEvent("CardEnabled", { agent: sa, enabled: true, ledgerClosedAt: "2026-10-20T10:00:00.000Z" }, 90);
    await createEvent("NoteSettled", { noteId: n9, agent: "CSOMEONEELSE", agentPayout: "1", debtRepaid: "1" }, 130); // another agent's

    const confirmed = await createAuthorization(user.id, { createdAt: new Date("2026-10-25T11:00:00Z") });
    const pending = await createAuthorization(user.id, { merchant: "Galp fuel", amountCents: 62_00n, chainStatus: "PENDING", createdAt: new Date("2026-10-25T11:45:00Z") });
    await createAuthorization(user.id, { merchant: "Worten", amountCents: 349_00n, decision: "DECLINED", declineReason: "INSUFFICIENT_FUNDS", chainStatus: "PENDING", createdAt: new Date("2026-10-22T09:00:00Z") });

    const o = await loadAgentOverview(user.id, opts);

    expect(o.positionSource).toBe("chain");
    expect(o.position).toEqual(jsonify(live));
    expect(o.rates).toEqual({ agentAprBps: 1200, borrowIndex: "1012345678901234567", protocolNow: PROTOCOL_NOW, fetchedAtMs: NOW_MS, live: true });
    expect(o.pendingHolds).toBe(String(62_00n * 100_000n));
    expect(o.agent).toMatchObject({ cardEnabledOnChain: true, cardPaused: false });
    expect(o.onboarding).toEqual({ passkey: true, smartAccount: true, card: true, cardActivated: true });

    // The live read refreshed the ASA cache and fixed the DB mirror of the card flag.
    const stored = await db.agent.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.cardEnabledOnChain).toBe(true);
    expect(stored.cachedPosition).toEqual(jsonify(live));
    expect(stored.cachedAt?.getTime()).toBe(NOW_MS);

    expect(o.deals.map((d) => [d.noteId, d.status])).toEqual([
      [n7, "MINTED"],
      [n12, "MINTED"],
      [n14, "CANCELLED"],
      [n9, "SETTLED"],
    ]);
    expect(o.deals[0]).toMatchObject({ overdue: true, used: String(512n * EUR), creditLimit: String(1_000n * EUR), agentCommission: String(2_000n * EUR) });
    expect(o.deals[1]).toMatchObject({ overdue: false, used: "262518000000", creditLimit: String(3_750n * EUR), agentCommission: String(7_500n * EUR), mintTxHash: `${TX}mint-${n12}` });
    expect(o.deals[2]).toMatchObject({ used: "0", debtCarried: "20000000000" });
    expect(o.deals[3]).toMatchObject({ used: "0", agentPayout: "44112300000" });

    expect(o.activity.map((a) => a.kind)).toEqual(["card", "withdrawal", "card", "settlement", "cancellation", "card"]);
    expect(o.activity[0]).toMatchObject({ kind: "card", id: pending.id, merchant: "Galp fuel", amount: "620000000", decision: "APPROVED", chainStatus: "PENDING", txHash: null });
    expect(o.activity[1]).toMatchObject({ kind: "withdrawal", amount: "5000000000", to: sa, at: "2026-10-25T11:30:00.000Z" });
    expect(o.activity[2]).toMatchObject({ kind: "card", id: confirmed.id, fromBalance: "0", fromCredit: "48000000", chainStatus: "CONFIRMED" });
    expect(o.activity[3]).toMatchObject({ kind: "settlement", noteId: n9, agentPayout: "44112300000", debtRepaid: "30887700000" });
    expect(o.activity[4]).toMatchObject({ kind: "cancellation", noteId: n14, debtCarried: "20000000000", graceDeadline: 1_815_552_000 });
    expect(o.activity[5]).toMatchObject({ kind: "card", decision: "DECLINED", declineReason: "INSUFFICIENT_FUNDS" });
  });

  it("falls back to the cached position when the chain can't be read, and estimates the protocol clock", async () => {
    const cachedAt = new Date(NOW_MS - 60_000);
    const cachedLive = position([], { cardBalance: 10n * EUR, availableCredit: 100n * EUR, borrowableNow: 100n * EUR });
    const { user } = await createUser({ cardEnabledOnChain: true, cachedPosition: jsonify(cachedLive), cachedAt });
    chain.readAgentPosition.mockRejectedValue(notImplemented());
    chain.readPoolStats.mockRejectedValue(notImplemented());
    // Scope event queries to this test's pool, so ClockAdvanced events other
    // processes indexed into the shared test database can't win the "newest" query.
    chain.getDeployment.mockResolvedValue({
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      teurc: "CTEURC",
      cpcvNote: "CNOTE",
      advancePool: "CPOOL",
      explorerBase: "https://stellar.expert/explorer/testnet",
    });
    // Demo clock: protocol_now was 81 days ahead of the ledger close time.
    const closedAt = NOW_MS / 1000 - 3_600;
    await createEvent("ClockAdvanced", { secs: "6998400", protocolNow: String(closedAt + 81 * 86_400), ledgerClosedAt: new Date(closedAt * 1000).toISOString() }, 50);

    // A draw confirmed after the cached read isn't in the cache: it still counts as a hold.
    await createAuthorization(user.id, { amountCents: 5_00n, chainStatus: "CONFIRMED", createdAt: new Date(NOW_MS - 30_000) });
    await createAuthorization(user.id, { amountCents: 7_00n, chainStatus: "CONFIRMED", createdAt: new Date(NOW_MS - 120_000) });

    const o = await loadAgentOverview(user.id, opts);
    expect(o.positionSource).toBe("cache");
    expect(o.positionAsOf).toBe(cachedAt.toISOString());
    expect(o.position).toEqual(jsonify(cachedLive));
    expect(o.rates).toEqual({ agentAprBps: 1200, borrowIndex: SCALE.toString(), protocolNow: NOW_MS / 1000 + 81 * 86_400, fetchedAtMs: NOW_MS, live: false });
    expect(o.pendingHolds).toBe(String(5_00n * 100_000n));
    // Without a live read the DB mirror decides the card state.
    expect(o.agent.cardEnabledOnChain).toBe(true);
    expect(o.onboarding.cardActivated).toBe(true);
  });

  it("no live read and no cache: position null; stats alone keep the clock but not the ticking", async () => {
    const { user } = await createUser({ cardEnabledOnChain: false });
    chain.readAgentPosition.mockRejectedValue(new Error("timeout"));
    const o = await loadAgentOverview(user.id, opts);
    expect(o).toMatchObject({ position: null, positionSource: "none", positionAsOf: null, pendingHolds: "0" });
    expect(o.rates).toMatchObject({ protocolNow: PROTOCOL_NOW, live: false });
  });

  it("a card disabled after activation is paused, not back in onboarding", async () => {
    const { user, smartAccount } = await createUser({ cardEnabledOnChain: true });
    chain.readAgentPosition.mockResolvedValue(position([], { cardEnabled: false }));
    await createEvent("CardEnabled", { agent: smartAccount, enabled: true }, 10);
    await createEvent("CardEnabled", { agent: smartAccount, enabled: false }, 20);
    const o = await loadAgentOverview(user.id, opts);
    expect(o.agent).toMatchObject({ cardEnabledOnChain: false, cardPaused: true });
    expect(o.onboarding.cardActivated).toBe(true);
    expect((await db.agent.findUniqueOrThrow({ where: { userId: user.id } })).cardEnabledOnChain).toBe(false);
  });

  it("seed agents report their demo signer", async () => {
    const { user } = await createUser({ passkey: false, signerKind: "demo-ed25519", cardEnabledOnChain: true });
    const o = await loadAgentOverview(user.id, opts);
    expect(o.agent.signerKind).toBe("demo-ed25519");
    expect(o.onboarding).toMatchObject({ passkey: false, smartAccount: true, card: true, cardActivated: true });
  });

  it("GET /api/agent/overview returns the overview as JSON for the signed-in agent", async () => {
    const { user } = await createUser({ cardEnabledOnChain: true });
    session.requireAgent.mockResolvedValue({ userId: user.id, email: user.email, role: "AGENT", passkeyVerified: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    const body = (await res.json()) as AgentOverviewResponse;
    expect(body.user.email).toBe(user.email);
    expect(body.positionSource).toBe("chain");
    expect(body.rates.borrowIndex).toBe("1012345678901234567");

    session.requireAgent.mockRejectedValue(unauthorized());
    const denied = await GET();
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
  });
});
