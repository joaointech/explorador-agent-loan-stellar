// ASA handler pipeline against the test database, chain calls mocked.

import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({
  readAgentPosition: vi.fn(),
  readPoolStats: vi.fn(),
  cardDraw: vi.fn(),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));
vi.mock("@/lib/stellar/contracts", () => chain);

import { db } from "@/lib/db";
import { jsonify } from "@/lib/json";
import { parseAsaRequest } from "@/lib/lithic/asa";

import { chainPosition, chainStats, EUR, hasTestDb, testAgents } from "./__tests__/fixtures";
import { processAsaRequest } from "./asa";
import { retryDraws } from "./retry";
import { buildSimulatedAsaRequest, type SimulatedAuthorizationInput } from "./simulated-network";

type TestAgent = Awaited<ReturnType<ReturnType<typeof testAgents>["create"]>>;

const agents = testAgents("asa-tests");

function asa(agent: TestAgent, amountCents: bigint, over: Partial<SimulatedAuthorizationInput> = {}) {
  const body = buildSimulatedAsaRequest({
    cardToken: agent.lithicCardToken!,
    last4: agent.cardLast4!,
    amountCents,
    merchant: "Pastelaria Aloma",
    ...over,
  });
  return parseAsaRequest(JSON.stringify(body));
}

const sha256 = (s: string) => new Uint8Array(createHash("sha256").update(s).digest());
const rowsOf = (agent: TestAgent) => db.cardAuthorization.findMany({ where: { agentId: agent.userId }, orderBy: { createdAt: "asc" } });

describe.skipIf(!hasTestDb)("ASA handler pipeline (test database)", () => {
  beforeAll(() => agents.cleanup());
  afterAll(async () => {
    await agents.cleanup();
    await db.chainEvent.deleteMany({ where: { txHash: { startsWith: "asa-test-" } } });
  });

  beforeEach(() => {
    chain.readAgentPosition.mockReset().mockResolvedValue(chainPosition());
    chain.readPoolStats.mockReset().mockResolvedValue(chainStats());
    chain.cardDraw.mockReset().mockImplementation(async (_agent: string, amount: bigint) => ({
      txHash: `tx${randomUUID().replace(/-/g, "")}`,
      ledger: 1,
      result: { fromBalance: 0n, fromCredit: amount },
    }));
  });

  it("approves, records PENDING, then draws on-chain and confirms with the split", async () => {
    const agent = await agents.create();
    const req = asa(agent, 480n);

    const outcome = await processAsaRequest(req);
    expect(outcome.response).toEqual({ result: "APPROVED", token: req.token });
    expect(outcome.decision).toBe("APPROVED");
    let [row] = await rowsOf(agent);
    expect(row).toMatchObject({ id: outcome.authorizationId, lithicToken: req.token, amountCents: 480n, merchant: "Pastelaria Aloma", decision: "APPROVED", chainStatus: "PENDING", attempts: 0 });

    chain.readAgentPosition.mockResolvedValue(chainPosition({ availableCredit: 3_745n * EUR, totalDebt: 48_000_000n }));
    chain.cardDraw.mockResolvedValueOnce({ txHash: "abc123", ledger: 7, result: { fromBalance: 0n, fromCredit: 48_000_000n } });
    await outcome.followUp!();

    expect(chain.cardDraw).toHaveBeenCalledWith(agent.smartAccount, 48_000_000n, sha256(req.token));
    [row] = await rowsOf(agent);
    expect(row).toMatchObject({ chainStatus: "CONFIRMED", fromBalanceStroops: 0n, fromCreditStroops: 48_000_000n, txHash: "abc123", attempts: 1 });
    const refreshed = await db.agent.findUniqueOrThrow({ where: { userId: agent.userId } });
    expect(refreshed.cachedPosition).toMatchObject({ availableCredit: String(3_745n * EUR), totalDebt: "48000000" });
    expect(refreshed.cachedAt).toBeInstanceOf(Date);
  });

  it("is idempotent on the Lithic transaction token", async () => {
    const agent = await agents.create();
    const req = asa(agent, 6_200n, { merchant: "Galp fuel" });
    const first = await processAsaRequest(req);
    chain.readAgentPosition.mockClear();

    const replay = await processAsaRequest(req);
    expect(replay.authorizationId).toBe(first.authorizationId);
    expect(replay.response).toEqual(first.response);
    expect(chain.readAgentPosition).not.toHaveBeenCalled();
    expect(await rowsOf(agent)).toHaveLength(1);

    // Concurrent retries of one authorization still produce a single row.
    const req2 = asa(agent, 100n);
    const [a, b] = await Promise.all([processAsaRequest(req2), processAsaRequest(req2)]);
    expect(a.authorizationId).toBe(b.authorizationId);
    expect(await rowsOf(agent)).toHaveLength(2);

    // A replay of a declined authorization returns the stored decline.
    const tooBig = asa(agent, 10_000_000n);
    expect((await processAsaRequest(tooBig)).response.result).toBe("INSUFFICIENT_FUNDS");
    expect((await processAsaRequest(tooBig)).response.result).toBe("INSUFFICIENT_FUNDS");
  });

  it("re-arms the draw when a replay finds it never started", async () => {
    const agent = await agents.create();
    const req = asa(agent, 349_00n, { merchant: "Worten" });
    await processAsaRequest(req); // after() never ran
    const replay = await processAsaRequest(req);
    await replay.followUp!();
    expect(chain.cardDraw).toHaveBeenCalledTimes(1);
    expect((await rowsOf(agent))[0].chainStatus).toBe("CONFIRMED");
    // A second follow-up finds nothing to claim.
    await replay.followUp!();
    expect(chain.cardDraw).toHaveBeenCalledTimes(1);
  });

  it("declines INSUFFICIENT_FUNDS once pending holds use up spendable", async () => {
    const agent = await agents.create();
    chain.readAgentPosition.mockResolvedValue(chainPosition({ cardBalance: 20n * EUR, availableCredit: 80n * EUR, borrowableNow: 80n * EUR }));

    const first = await processAsaRequest(asa(agent, 6_000n)); // €60 of €100
    expect(first.response.result).toBe("APPROVED");
    const second = await processAsaRequest(asa(agent, 6_000n)); // €60 > €40 left
    expect(second.response.result).toBe("INSUFFICIENT_FUNDS");
    const third = await processAsaRequest(asa(agent, 4_000n)); // exactly €40
    expect(third.response.result).toBe("APPROVED");

    const rows = await rowsOf(agent);
    expect(rows.map((r) => [r.decision, r.declineReason])).toEqual([
      ["APPROVED", null],
      ["DECLINED", "INSUFFICIENT_FUNDS"],
      ["APPROVED", null],
    ]);
  });

  it("serializes concurrent authorizations of one agent (row lock)", async () => {
    const agent = await agents.create();
    chain.readAgentPosition.mockResolvedValue(chainPosition({ availableCredit: 100n * EUR, borrowableNow: 100n * EUR }));
    const results = await Promise.all([1, 2, 3].map(() => processAsaRequest(asa(agent, 6_000n))));
    expect(results.map((r) => r.response.result).sort()).toEqual(["APPROVED", "INSUFFICIENT_FUNDS", "INSUFFICIENT_FUNDS"]);
  });

  it("caps credit by the pool's lendable and leverage headroom", async () => {
    const agent = await agents.create();
    chain.readPoolStats.mockResolvedValue(chainStats({ lendable: 10n * EUR }));
    expect((await processAsaRequest(asa(agent, 1_001n))).response.result).toBe("INSUFFICIENT_FUNDS");
    chain.readPoolStats.mockResolvedValue(chainStats({ leverageHeadroom: 5n * EUR }));
    expect((await processAsaRequest(asa(agent, 501n))).response.result).toBe("INSUFFICIENT_FUNDS");
    expect((await processAsaRequest(asa(agent, 500n))).response.result).toBe("APPROVED");
  });

  it("declines CARD_PAUSED when the card is not enabled on-chain", async () => {
    const agent = await agents.create({ cardEnabledOnChain: false });
    chain.readAgentPosition.mockResolvedValue(chainPosition({ cardEnabled: false }));
    const outcome = await processAsaRequest(asa(agent, 480n));
    expect(outcome.response.result).toBe("CARD_PAUSED");
    expect((await rowsOf(agent))[0]).toMatchObject({ decision: "DECLINED", declineReason: "CARD_PAUSED" });
    await outcome.followUp!(); // cache refresh only
    expect(chain.cardDraw).not.toHaveBeenCalled();
  });

  it("declines CARD_PAUSED when the chain says disabled, and corrects a stale mirror", async () => {
    const agent = await agents.create({ cardEnabledOnChain: true });
    chain.readAgentPosition.mockResolvedValue(chainPosition({ cardEnabled: false }));
    const outcome = await processAsaRequest(asa(agent, 480n));
    expect(outcome.response.result).toBe("CARD_PAUSED");
    await outcome.followUp!();
    expect((await db.agent.findUniqueOrThrow({ where: { userId: agent.userId } })).cardEnabledOnChain).toBe(false);
  });

  it("follows the chain when the mirror lags behind enable_card, and corrects it", async () => {
    const agent = await agents.create({ cardEnabledOnChain: false });
    const outcome = await processAsaRequest(asa(agent, 480n)); // chain mock: card enabled
    expect(outcome.response.result).toBe("APPROVED");
    await outcome.followUp!();
    expect(chain.cardDraw).toHaveBeenCalledTimes(1);
    expect((await db.agent.findUniqueOrThrow({ where: { userId: agent.userId } })).cardEnabledOnChain).toBe(true);
  });

  it("without a live read, a disabled mirror declines CARD_PAUSED", async () => {
    const agent = await agents.create({ cardEnabledOnChain: false });
    await db.agent.update({ where: { userId: agent.userId }, data: { cachedPosition: jsonify(chainPosition()), cachedAt: new Date() } });
    chain.readAgentPosition.mockRejectedValue(new Error("RPC unavailable"));
    expect((await processAsaRequest(asa(agent, 480n))).response.result).toBe("CARD_PAUSED");
  });

  it("declines SUSPECTED_FRAUD for an unknown card and records nothing", async () => {
    const agent = await agents.create();
    const outcome = await processAsaRequest(asa(agent, 480n, { cardToken: "unknown-card-token" }));
    expect(outcome).toMatchObject({ response: { result: "SUSPECTED_FRAUD" }, authorizationId: null, followUp: null });
    expect(await rowsOf(agent)).toHaveLength(0);
  });

  it("falls back to the cached position, counting draws confirmed since the cache", async () => {
    const agent = await agents.create();
    const cachedAt = new Date(Date.now() - 60_000);
    await db.agent.update({
      where: { userId: agent.userId },
      data: { cachedPosition: jsonify(chainPosition({ availableCredit: 50n * EUR, borrowableNow: 50n * EUR })), cachedAt },
    });
    // A €10 draw confirmed after the cached read: not in the cache yet.
    await db.cardAuthorization.create({
      data: { lithicToken: `sim_txn_${randomUUID()}`, agentId: agent.userId, amountCents: 1_000n, merchant: "Earlier", decision: "APPROVED", chainStatus: "CONFIRMED", txHash: "t0" },
    });
    chain.readAgentPosition.mockRejectedValue(new Error("RPC unavailable"));
    chain.readPoolStats.mockRejectedValue(new Error("RPC unavailable"));

    expect((await processAsaRequest(asa(agent, 4_001n))).response.result).toBe("INSUFFICIENT_FUNDS");
    expect((await processAsaRequest(asa(agent, 4_000n))).response.result).toBe("APPROVED");
  });

  it("gives up on a slow RPC after 1.2 s and answers from the cache", async () => {
    const agent = await agents.create();
    await db.agent.update({ where: { userId: agent.userId }, data: { cachedPosition: jsonify(chainPosition()), cachedAt: new Date() } });
    chain.readAgentPosition.mockReturnValue(new Promise(() => {}));
    chain.readPoolStats.mockReturnValue(new Promise(() => {}));

    const started = Date.now();
    const outcome = await processAsaRequest(asa(agent, 480n));
    const elapsed = Date.now() - started;
    expect(outcome.response.result).toBe("APPROVED");
    expect(elapsed).toBeGreaterThanOrEqual(1_150);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("declines when there is neither a live read nor a cache", async () => {
    const agent = await agents.create();
    chain.readAgentPosition.mockRejectedValue(new Error("RPC unavailable"));
    expect((await processAsaRequest(asa(agent, 480n))).response.result).toBe("INSUFFICIENT_FUNDS");
  });

  it("answers a balance inquiry with spendable in cents and records nothing", async () => {
    const agent = await agents.create();
    chain.readAgentPosition.mockResolvedValue(chainPosition({ cardBalance: 12n * EUR, availableCredit: 100n * EUR, borrowableNow: 100n * EUR }));
    await processAsaRequest(asa(agent, 2_000n)); // €20 pending hold
    const outcome = await processAsaRequest(asa(agent, 0n, { status: "BALANCE_INQUIRY" }));
    expect(outcome.response).toMatchObject({ result: "APPROVED", balance: { amount: 9_200, available: 9_200 } });
    expect(outcome.authorizationId).toBeNull();
    expect(await rowsOf(agent)).toHaveLength(1);
  });

  it("approves and records credits without any on-chain action", async () => {
    const agent = await agents.create();
    const outcome = await processAsaRequest(asa(agent, -500n, { status: "CREDIT_AUTHORIZATION" }));
    expect(outcome.response.result).toBe("APPROVED");
    expect(outcome.followUp).toBeNull();
    expect((await rowsOf(agent))[0]).toMatchObject({ decision: "APPROVED", amountCents: -500n, chainStatus: "CONFIRMED", txHash: null });
    expect(chain.readAgentPosition).not.toHaveBeenCalled();
  });

  it("marks a failed draw FAILED and retries it from the sweep, at most 3 attempts", async () => {
    const agent = await agents.create();
    chain.cardDraw.mockRejectedValue(new Error("HostError: Error(Contract, #4)")); // InsufficientCredit
    const outcome = await processAsaRequest(asa(agent, 480n));
    await outcome.followUp!();
    expect((await rowsOf(agent))[0]).toMatchObject({ chainStatus: "FAILED", attempts: 1 });

    expect(await retryDraws({ agentId: agent.userId })).toMatchObject({ ran: true, examined: 1, failed: 1 });
    expect((await rowsOf(agent))[0]).toMatchObject({ chainStatus: "FAILED", attempts: 2 });

    chain.cardDraw.mockResolvedValueOnce({ txHash: "third-time-lucky", ledger: 9, result: { fromBalance: 0n, fromCredit: 48_000_000n } });
    expect(await retryDraws({ agentId: agent.userId })).toMatchObject({ examined: 1, confirmed: 1 });
    expect((await rowsOf(agent))[0]).toMatchObject({ chainStatus: "CONFIRMED", attempts: 3, txHash: "third-time-lucky" });
    expect(chain.cardDraw).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after the third failed attempt", async () => {
    const agent = await agents.create();
    chain.cardDraw.mockRejectedValue(new Error("simulation failed"));
    await (await processAsaRequest(asa(agent, 480n))).followUp!();
    await retryDraws({ agentId: agent.userId });
    await retryDraws({ agentId: agent.userId });
    expect(await retryDraws({ agentId: agent.userId })).toMatchObject({ examined: 0 });
    expect((await rowsOf(agent))[0]).toMatchObject({ chainStatus: "FAILED", attempts: 3 });
    expect(chain.cardDraw).toHaveBeenCalledTimes(3);
  });

  it("treats DuplicateDraw as already landed and recovers the split from indexed events", async () => {
    const agent = await agents.create();
    const req = asa(agent, 480n);
    const outcome = await processAsaRequest(req);
    const authRefHex = Buffer.from(sha256(req.token)).toString("hex");
    await db.chainEvent.create({
      data: {
        contract: "CPOOL",
        type: "card_draw",
        ledger: 42,
        txHash: `asa-test-${randomUUID()}`,
        eventIdx: 0,
        data: { agent: agent.smartAccount, amount: "48000000", from_balance: "8000000", from_credit: "40000000", auth_ref: authRefHex },
      },
    });
    chain.cardDraw.mockRejectedValue(new Error("HostError: Error(Contract, #12)"));
    await outcome.followUp!();
    const [row] = await rowsOf(agent);
    expect(row).toMatchObject({ chainStatus: "CONFIRMED", fromBalanceStroops: 8_000_000n, fromCreditStroops: 40_000_000n });
    expect(row.txHash).toMatch(/^asa-test-/);
  });

  it("sweeps stuck draws: PENDING whose after() never ran, SUBMITTED out of attempts", async () => {
    const agent = await agents.create();
    const pending = await processAsaRequest(asa(agent, 480n));
    const exhausted = await processAsaRequest(asa(agent, 500n));
    const old = new Date(Date.now() - 10 * 60_000);
    await db.cardAuthorization.update({ where: { id: pending.authorizationId! }, data: { createdAt: old } });
    await db.cardAuthorization.update({ where: { id: exhausted.authorizationId! }, data: { createdAt: old, chainStatus: "SUBMITTED", attempts: 3 } });

    expect(await retryDraws({ agentId: agent.userId })).toMatchObject({ examined: 2, confirmed: 1, failed: 1 });
    const rows = await db.cardAuthorization.findMany({ where: { agentId: agent.userId } });
    expect(rows.find((r) => r.id === pending.authorizationId)).toMatchObject({ chainStatus: "CONFIRMED", attempts: 1 });
    expect(rows.find((r) => r.id === exhausted.authorizationId)).toMatchObject({ chainStatus: "FAILED", attempts: 3 });
    expect(chain.cardDraw).toHaveBeenCalledTimes(1);
  });

  it("leaves fresh in-flight draws to their own after()", async () => {
    const agent = await agents.create();
    await processAsaRequest(asa(agent, 480n));
    expect(await retryDraws({ agentId: agent.userId })).toMatchObject({ examined: 0 });
    expect(chain.cardDraw).not.toHaveBeenCalled();
  });
});
