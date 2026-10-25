// Card API routes end-to-end on the simulated card network (no LITHIC_API_KEY):
// route handlers + pipeline + test database, chain calls and session mocked.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  const secret = "whsec_" + Buffer.from("routes-test-asa-secret").toString("base64");
  process.env.LITHIC_ASA_HMAC_SECRET = secret;
  process.env.CRON_SECRET = "cron-test-secret";
  delete process.env.LITHIC_API_KEY;
  return secret;
});

const chain = vi.hoisted(() => ({
  readAgentPosition: vi.fn(),
  readPoolStats: vi.fn(),
  cardDraw: vi.fn(),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));
vi.mock("@/lib/stellar/contracts", () => chain);

const session = vi.hoisted(() => ({ requireAgent: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void scheduled.push(fn) }));

const sweep = vi.hoisted(() => ({ retryDraws: vi.fn() }));
vi.mock("@/lib/card/retry", () => sweep);

import { GET as getAuthorization } from "@/app/api/agent/card/authorizations/[id]/route";
import { GET as reveal } from "@/app/api/agent/card/reveal/route";
import { POST as simulate } from "@/app/api/agent/card/simulate/route";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/retry-draws/route";
import { POST as asa } from "@/app/api/lithic/asa/route";
import { HttpError } from "@/lib/http";
import { signAsaPayload } from "@/lib/lithic/webhook";

import { chainPosition, chainStats, hasTestDb, testAgents } from "./__tests__/fixtures";
import { buildSimulatedAsaRequest } from "./simulated-network";

type TestAgent = Awaited<ReturnType<ReturnType<typeof testAgents>["create"]>>;

const agents = testAgents("route-tests");

const signedIn = (agent: TestAgent) =>
  session.requireAgent.mockResolvedValue({ userId: agent.userId, email: "agent@route-tests.invalid", role: "AGENT", passkeyVerified: true });

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });

const statusOf = (id: string) =>
  getAuthorization(new Request(`http://localhost/api/agent/card/authorizations/${id}`), { params: Promise.resolve({ id }) });

async function runScheduled() {
  while (scheduled.length) await scheduled.shift()!();
}

describe.skipIf(!hasTestDb)("card API routes on the simulated network (test database)", () => {
  beforeAll(() => agents.cleanup());
  afterAll(() => agents.cleanup());

  beforeEach(() => {
    scheduled.length = 0;
    session.requireAgent.mockReset().mockRejectedValue(new HttpError(401, "UNAUTHORIZED", "Sign in required"));
    session.requireAdmin.mockReset().mockRejectedValue(new HttpError(401, "UNAUTHORIZED", "Sign in required"));
    sweep.retryDraws.mockReset().mockResolvedValue({ ran: true, examined: 0, confirmed: 0, recovered: 0, failed: 0, skipped: 0 });
    chain.readAgentPosition.mockReset().mockResolvedValue(chainPosition());
    chain.readPoolStats.mockReset().mockResolvedValue(chainStats());
    chain.cardDraw.mockReset().mockImplementation(async (_agent: string, amount: bigint) => ({
      txHash: `tx${randomUUID().replace(/-/g, "")}`,
      ledger: 1,
      result: { fromBalance: 0n, fromCredit: amount },
    }));
  });

  describe("POST /api/agent/card/simulate", () => {
    it("approves a purchase, then the draw lands on-chain and the status route reports it", async () => {
      const agent = await agents.create();
      signedIn(agent);

      const res = await simulate(post("/api/agent/card/simulate", { amountEur: 4.8, merchant: "Pastelaria Aloma" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ authorizationId: expect.any(String), decision: "APPROVED", declineReason: null, via: "simulated" });

      let status = await (await statusOf(body.authorizationId)).json();
      expect(status).toMatchObject({ id: body.authorizationId, decision: "APPROVED", chainStatus: "PENDING", txHash: null, explorerUrl: null });

      expect(scheduled).toHaveLength(1);
      chain.cardDraw.mockResolvedValueOnce({ txHash: "deadbeef", ledger: 3, result: { fromBalance: 0n, fromCredit: 48_000_000n } });
      await runScheduled();
      expect(chain.cardDraw).toHaveBeenCalledWith(agent.smartAccount, 48_000_000n, expect.any(Uint8Array));

      status = await (await statusOf(body.authorizationId)).json();
      expect(status).toEqual({
        id: body.authorizationId,
        decision: "APPROVED",
        chainStatus: "CONFIRMED",
        fromBalance: "0",
        fromCredit: "48000000",
        txHash: "deadbeef",
        explorerUrl: "https://stellar.expert/explorer/testnet/tx/deadbeef",
      });
    });

    it("declines a purchase above spendable with INSUFFICIENT_FUNDS and draws nothing", async () => {
      const agent = await agents.create();
      signedIn(agent);
      const res = await simulate(post("/api/agent/card/simulate", { amountEur: 3_750.01, merchant: "Worten" }));
      expect(await res.json()).toMatchObject({ decision: "DECLINED", declineReason: "INSUFFICIENT_FUNDS", via: "simulated" });
      expect(scheduled).toHaveLength(1); // only the cache refresh
      await runScheduled();
      expect(chain.cardDraw).not.toHaveBeenCalled();
    });

    it("declines with CARD_PAUSED until the card is enabled on-chain", async () => {
      const agent = await agents.create({ cardEnabledOnChain: false });
      signedIn(agent);
      const res = await simulate(post("/api/agent/card/simulate", { amountEur: 62, merchant: "Galp fuel" }));
      expect(await res.json()).toMatchObject({ decision: "DECLINED", declineReason: "CARD_PAUSED" });
    });

    it("validates the body", async () => {
      const agent = await agents.create();
      signedIn(agent);
      for (const bad of [{ amountEur: -1, merchant: "X" }, { amountEur: 1.234, merchant: "X" }, { amountEur: 5, merchant: "  " }, { amountEur: 60_000, merchant: "X" }, {}]) {
        const res = await simulate(post("/api/agent/card/simulate", bad));
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
      }
      expect((await simulate(post("/api/agent/card/simulate", "not json"))).status).toBe(400);
    });

    it("requires a signed-in agent with a card", async () => {
      expect((await simulate(post("/api/agent/card/simulate", { amountEur: 1, merchant: "X" }))).status).toBe(401);

      const cardless = await agents.create({ cardToken: null });
      signedIn(cardless);
      const res = await simulate(post("/api/agent/card/simulate", { amountEur: 1, merchant: "X" }));
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("NO_CARD");

      session.requireAgent.mockResolvedValue({ userId: "no-such-agent", email: "x@route-tests.invalid", role: "AGENT", passkeyVerified: false });
      expect((await (await simulate(post("/api/agent/card/simulate", { amountEur: 1, merchant: "X" }))).json()).error.code).toBe("AGENT_NOT_READY");
    });
  });

  describe("GET /api/agent/card/authorizations/[id]", () => {
    it("only shows the agent's own authorizations", async () => {
      const owner = await agents.create();
      signedIn(owner);
      const { authorizationId } = await (await simulate(post("/api/agent/card/simulate", { amountEur: 1, merchant: "X" }))).json();
      signedIn(await agents.create());
      expect((await statusOf(authorizationId)).status).toBe(404);
      expect((await statusOf("does-not-exist")).status).toBe(404);
    });
  });

  describe("GET /api/agent/card/reveal", () => {
    it("returns obviously fake details for a simulated card, never cached", async () => {
      const agent = await agents.create();
      signedIn(agent);
      const res = await reveal();
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(await res.json()).toEqual({ pan: "4000000000004242", cvv: "000", expMonth: "12", expYear: String(new Date().getUTCFullYear() + 3) });
    });
  });

  describe("POST /api/lithic/asa", () => {
    it("accepts signed requests and schedules the draw", async () => {
      const agent = await agents.create();
      const body = JSON.stringify(buildSimulatedAsaRequest({ cardToken: agent.lithicCardToken!, last4: "4242", amountCents: 480n, merchant: "Pastelaria Aloma" }));
      const res = await asa(post("/api/lithic/asa", body, signAsaPayload(SECRET, body)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: "APPROVED", token: JSON.parse(body).token });
      await runScheduled();
      expect(chain.cardDraw).toHaveBeenCalledTimes(1);
    });

    it("answers a balance inquiry", async () => {
      const agent = await agents.create();
      const body = JSON.stringify(buildSimulatedAsaRequest({ cardToken: agent.lithicCardToken!, last4: "4242", amountCents: 0n, merchant: "ATM", status: "BALANCE_INQUIRY" }));
      const res = await asa(post("/api/lithic/asa", body, signAsaPayload(SECRET, body)));
      expect(await res.json()).toMatchObject({ result: "APPROVED", balance: { amount: 375_000, available: 375_000 } });
    });

    it("rejects unsigned, tampered and stale requests with 401", async () => {
      const agent = await agents.create();
      const body = JSON.stringify(buildSimulatedAsaRequest({ cardToken: agent.lithicCardToken!, last4: "4242", amountCents: 480n, merchant: "X" }));
      expect((await asa(post("/api/lithic/asa", body))).status).toBe(401);
      expect((await asa(post("/api/lithic/asa", body.replace('"amount":480', '"amount":1'), signAsaPayload(SECRET, body)))).status).toBe(401);
      const stale = signAsaPayload(SECRET, body, { timestamp: Math.floor(Date.now() / 1000) - 600 });
      expect((await asa(post("/api/lithic/asa", body, stale))).status).toBe(401);
      expect(chain.readAgentPosition).not.toHaveBeenCalled();
    });

    it("rejects a signed body that is not an ASA request with 400", async () => {
      const body = JSON.stringify({ hello: "world" });
      const res = await asa(post("/api/lithic/asa", body, signAsaPayload(SECRET, body)));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_ASA_REQUEST");
    });
  });

  describe("/api/cron/retry-draws", () => {
    it("runs for an admin session or the CRON_SECRET bearer token, and nobody else", async () => {
      const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/cron/retry-draws", { headers });
      expect((await cronGet(req())).status).toBe(401);
      expect((await cronGet(req({ authorization: "Bearer wrong" }))).status).toBe(401);
      expect(sweep.retryDraws).not.toHaveBeenCalled();

      const res = await cronGet(req({ authorization: "Bearer cron-test-secret" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ran: true });

      session.requireAdmin.mockResolvedValue({ userId: "admin", email: "admin@route-tests.invalid", role: "ADMIN", passkeyVerified: true });
      expect((await cronPost(new Request("http://localhost/api/cron/retry-draws", { method: "POST" }))).status).toBe(200);
      expect(sweep.retryDraws).toHaveBeenCalledTimes(2);
    });
  });
});
