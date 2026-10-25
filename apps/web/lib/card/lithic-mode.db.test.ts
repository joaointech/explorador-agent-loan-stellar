// The Lithic path (LITHIC_API_KEY set) against a fake Lithic sandbox that
// behaves like the real one: `simulate/authorize` delivers a signed ASA
// request to our responder route and answers with the transaction token.

import { randomInt, randomUUID } from "node:crypto";

import { UnprocessableEntityError } from "lithic";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  const secret = "whsec_" + Buffer.from("lithic-mode-asa-secret").toString("base64");
  process.env.LITHIC_API_KEY = "sandbox-test-key";
  process.env.LITHIC_ASA_HMAC_SECRET = secret;
  return secret;
});

const chain = vi.hoisted(() => ({
  readAgentPosition: vi.fn(),
  readPoolStats: vi.fn(),
  cardDraw: vi.fn(),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));
vi.mock("@/lib/stellar/contracts", () => chain);

const session = vi.hoisted(() => ({ requireAgent: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void scheduled.push(fn) }));

// No 1 req/s spacing in tests (covered by rate-limit.test.ts).
vi.mock("@/lib/lithic/rate-limit", () => ({ createSpacer: () => <T>(fn: () => Promise<T>) => fn() }));

interface FakeCard {
  token: string;
  last_four: string;
  pan: string;
  cvv: string;
  exp_month: string;
  exp_year: string;
  memo?: string;
}

const sandbox = vi.hoisted(() => {
  const state = {
    cards: new Map<string, FakeCard>(),
    results: new Map<string, string>(),
    /** Set in beforeAll: POSTs a signed ASA request to our route, like Lithic does. */
    deliver: undefined as undefined | ((card: FakeCard, amount: number, descriptor: string, token: string) => Promise<unknown>),
    reachAsa: true,
    rejectWith: undefined as undefined | Error,
  };
  const client = {
    cards: {
      create: vi.fn(async (params: { memo?: string }) => {
        const token = crypto.randomUUID();
        const last4 = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
        const card: FakeCard = { token, last_four: last4, pan: `411111000000${last4}`, cvv: "321", exp_month: "10", exp_year: "2031", memo: params.memo };
        state.cards.set(token, card);
        return card;
      }),
      retrieve: vi.fn(async (token: string) => {
        const card = state.cards.get(token);
        if (!card) throw new Error(`404 card ${token}`);
        return card;
      }),
    },
    transactions: {
      simulateAuthorization: vi.fn(async ({ amount, descriptor, pan }: { amount: number; descriptor: string; pan: string }) => {
        if (state.rejectWith) throw state.rejectWith;
        const card = [...state.cards.values()].find((c) => c.pan === pan);
        if (!card) throw new Error("unknown PAN");
        const token = crypto.randomUUID();
        if (state.reachAsa) await state.deliver!(card, amount, descriptor, token);
        return { token, debugging_request_id: crypto.randomUUID() };
      }),
      retrieve: vi.fn(async (token: string) => ({ token, result: state.results.get(token) ?? "APPROVED" })),
    },
  };
  return { state, client };
});
vi.mock("@/lib/lithic/client", () => ({
  SANDBOX_VISA_PROGRAM: "00000000-0000-0000-1000-000000000000",
  lithicEnabled: () => true,
  getLithic: () => sandbox.client,
}));

import { GET as getAuthorization } from "@/app/api/agent/card/authorizations/[id]/route";
import { GET as reveal } from "@/app/api/agent/card/reveal/route";
import { POST as simulateRoute } from "@/app/api/agent/card/simulate/route";
import { POST as asaRoute } from "@/app/api/lithic/asa/route";
import { db } from "@/lib/db";
import { createAgentCard } from "@/lib/lithic/cards";
import { signAsaPayload } from "@/lib/lithic/webhook";

import { chainPosition, chainStats, hasTestDb, testAgents } from "./__tests__/fixtures";
import { simulatePurchase } from "./simulate";
import { buildSimulatedAsaRequest } from "./simulated-network";

type TestAgent = Awaited<ReturnType<ReturnType<typeof testAgents>["create"]>>;

const agents = testAgents("lithic-mode-tests");
const asaResponses: unknown[] = [];

async function lithicAgent(): Promise<TestAgent> {
  const agent = await agents.create({ cardToken: null });
  await createAgentCard(agent.userId);
  const withCard = await db.agent.findUniqueOrThrow({ where: { userId: agent.userId } });
  session.requireAgent.mockResolvedValue({ userId: agent.userId, email: "a@lithic-mode-tests.invalid", role: "AGENT", passkeyVerified: true });
  return withCard;
}

const simulate = (body: unknown) =>
  simulateRoute(new Request("http://localhost/api/agent/card/simulate", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe.skipIf(!hasTestDb)("Lithic sandbox mode (fake Lithic, test database)", () => {
  beforeAll(async () => {
    await agents.cleanup();
    sandbox.state.deliver = async (card, amount, descriptor, token) => {
      const body = JSON.stringify(
        buildSimulatedAsaRequest({ cardToken: card.token, last4: card.last_four, memo: card.memo, amountCents: BigInt(amount), merchant: descriptor, token }),
      );
      const res = await asaRoute(
        new Request("http://localhost/api/lithic/asa", { method: "POST", body, headers: { "content-type": "application/json", ...signAsaPayload(SECRET, body) } }),
      );
      asaResponses.push({ status: res.status, body: await res.json() });
    };
  });
  afterAll(() => agents.cleanup());

  beforeEach(() => {
    scheduled.length = 0;
    asaResponses.length = 0;
    sandbox.state.reachAsa = true;
    sandbox.state.rejectWith = undefined;
    sandbox.client.cards.create.mockClear();
    sandbox.client.transactions.simulateAuthorization.mockClear();
    chain.readAgentPosition.mockReset().mockResolvedValue(chainPosition());
    chain.readPoolStats.mockReset().mockResolvedValue(chainStats());
    chain.cardDraw.mockReset().mockImplementation(async (_agent: string, amount: bigint) => ({
      txHash: `tx${randomUUID().replace(/-/g, "")}`,
      ledger: 1,
      result: { fromBalance: 0n, fromCredit: amount },
    }));
  });

  describe("createAgentCard", () => {
    it("issues a virtual card on the sandbox Visa program with a UUID idempotency key, and stores it", async () => {
      const agent = await agents.create({ cardToken: null });
      const card = await createAgentCard(agent.userId);
      expect(sandbox.client.cards.create).toHaveBeenCalledWith({
        type: "VIRTUAL",
        memo: agent.userId,
        card_program_token: "00000000-0000-0000-1000-000000000000",
        "Idempotency-Key": expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      });
      expect(await db.agent.findUniqueOrThrow({ where: { userId: agent.userId } })).toMatchObject({ lithicCardToken: card.token, cardLast4: card.last4 });

      expect(await createAgentCard(agent.userId)).toEqual(card);
      expect(sandbox.client.cards.create).toHaveBeenCalledTimes(1);
    });

    it("uses the same idempotency key on a retry for the same agent", async () => {
      await createAgentCard("not-yet-an-agent-1");
      await createAgentCard("not-yet-an-agent-1");
      const [first, second] = sandbox.client.cards.create.mock.calls.map((c) => (c[0] as Record<string, string>)["Idempotency-Key"]);
      expect(first).toBe(second);
    });

    it("replaces a simulated card once Lithic is configured", async () => {
      const agent = await agents.create(); // sim_card_…
      const card = await createAgentCard(agent.userId);
      expect(card.token.startsWith("sim_")).toBe(false);
      expect((await db.agent.findUniqueOrThrow({ where: { userId: agent.userId } })).lithicCardToken).toBe(card.token);
    });
  });

  it("simulates a purchase through Lithic: signed ASA → decision → on-chain draw", async () => {
    const agent = await lithicAgent();
    const res = await simulate({ amountEur: 349, merchant: "Worten" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ authorizationId: expect.any(String), decision: "APPROVED", declineReason: null, via: "lithic" });
    expect(sandbox.client.transactions.simulateAuthorization).toHaveBeenLastCalledWith({ amount: 34_900, descriptor: "Worten", pan: expect.stringMatching(/^411111/) });
    expect(asaResponses).toEqual([{ status: 200, body: { result: "APPROVED", token: expect.any(String) } }]);

    // The ASA route scheduled the draw.
    expect(scheduled).toHaveLength(1);
    await scheduled.shift()!();
    expect(chain.cardDraw).toHaveBeenCalledWith(agent.smartAccount, 3_490_000_000n, expect.any(Uint8Array));
    const status = await (
      await getAuthorization(new Request("http://localhost/x"), { params: Promise.resolve({ id: body.authorizationId }) })
    ).json();
    expect(status).toMatchObject({ decision: "APPROVED", chainStatus: "CONFIRMED", fromCredit: "3490000000" });
  });

  it("returns Lithic-path declines from our responder", async () => {
    await lithicAgent();
    const body = await (await simulate({ amountEur: 4_000, merchant: "Worten" })).json();
    expect(body).toMatchObject({ decision: "DECLINED", declineReason: "INSUFFICIENT_FUNDS", via: "lithic" });
    expect(asaResponses).toEqual([{ status: 200, body: { result: "INSUFFICIENT_FUNDS", token: expect.any(String) } }]);
  });

  it("records Lithic's own decline when the ASA responder was not consulted", async () => {
    const agent = await lithicAgent();
    sandbox.state.reachAsa = false;
    sandbox.client.transactions.retrieve.mockImplementationOnce(async (token: string) => ({ token, result: "USER_TRANSACTION_LIMIT" }));
    const { response } = await simulatePurchase(agent.userId, { amountEur: 10, merchant: "Galp fuel" }, { asaWaitMs: 100 });
    expect(response).toMatchObject({ decision: "DECLINED", declineReason: "USER_TRANSACTION_LIMIT", via: "lithic" });
    expect(await db.cardAuthorization.findUniqueOrThrow({ where: { id: response.authorizationId } })).toMatchObject({ decision: "DECLINED", agentId: agent.userId });
  });

  it("fails loudly when Lithic approved without calling our ASA responder", async () => {
    const agent = await lithicAgent();
    sandbox.state.reachAsa = false;
    await expect(simulatePurchase(agent.userId, { amountEur: 10, merchant: "Galp fuel" }, { asaWaitMs: 100 })).rejects.toMatchObject({
      status: 502,
      code: "ASA_NOT_REACHED",
    });
  });

  it("maps a 422 from simulate/authorize to a recorded decline or a 422", async () => {
    const agent = await lithicAgent();
    const token = randomUUID();
    sandbox.state.rejectWith = new UnprocessableEntityError(422, { message: "Exceeds transaction limit", token }, undefined, new Headers());
    sandbox.state.results.set(token, "USER_TRANSACTION_LIMIT");
    const { response } = await simulatePurchase(agent.userId, { amountEur: 10, merchant: "X" }, { asaWaitMs: 100 });
    expect(response).toMatchObject({ decision: "DECLINED", declineReason: "USER_TRANSACTION_LIMIT" });

    sandbox.state.rejectWith = new UnprocessableEntityError(422, { message: "Card is closed" }, undefined, new Headers());
    await expect(simulatePurchase(agent.userId, { amountEur: 10, merchant: "X" })).rejects.toMatchObject({ status: 422, code: "LITHIC_DECLINED" });
  });

  it("reveals the sandbox PAN, CVV and expiry from Lithic", async () => {
    const agent = await lithicAgent();
    const card = sandbox.state.cards.get(agent.lithicCardToken!)!;
    expect(await (await reveal()).json()).toEqual({ pan: card.pan, cvv: "321", expMonth: "10", expYear: "2031" });
  });

  it("keeps simulated cards on the in-process network", async () => {
    const agent = await agents.create({ cardToken: `sim_card_${randomInt(1e9)}` });
    session.requireAgent.mockResolvedValue({ userId: agent.userId, email: "s@lithic-mode-tests.invalid", role: "AGENT", passkeyVerified: true });
    const body = await (await simulate({ amountEur: 4.8, merchant: "Pastelaria Aloma" })).json();
    expect(body).toMatchObject({ decision: "APPROVED", via: "simulated" });
    expect(sandbox.client.transactions.simulateAuthorization).not.toHaveBeenCalled();
  });
});
