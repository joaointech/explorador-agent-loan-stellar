// Admin actions and reads through the real route handlers, against the test
// database: settle / cancel / write-off status transitions, the agents table,
// the dashboard overview, treasury operations and the demo clock. The chain
// and the session are mocked.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY = "33".repeat(32);
  process.env.DEMO_MODE = "true";
});

const chain = vi.hoisted(() => ({
  readPoolStats: vi.fn(),
  readAgentPosition: vi.fn(),
  readNote: vi.fn(),
  settleNote: vi.fn(),
  cancelNote: vi.fn(),
  writeOff: vi.fn(),
  juniorDeposit: vi.fn(),
  juniorWithdraw: vi.fn(),
  claimFees: vi.fn(),
  advanceClock: vi.fn(),
  getDeployment: vi.fn(),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));
vi.mock("@/lib/stellar/contracts", () => chain);

const session = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

const sweep = vi.hoisted(() => ({ retryDraws: vi.fn() }));
vi.mock("@/lib/card/retry", () => sweep);

import { POST as writeOffRoute } from "@/app/api/admin/agents/[id]/write-off/route";
import { GET as agentsRoute } from "@/app/api/admin/agents/route";
import { POST as cancelRoute } from "@/app/api/admin/cpcv/[id]/cancel/route";
import { POST as settleRoute } from "@/app/api/admin/cpcv/[id]/settle/route";
import { POST as advanceClockRoute } from "@/app/api/admin/demo/advance-clock/route";
import { POST as claimFeesRoute } from "@/app/api/admin/fees/claim/route";
import { POST as juniorDepositRoute } from "@/app/api/admin/junior/deposit/route";
import { POST as juniorWithdrawRoute } from "@/app/api/admin/junior/withdraw/route";
import { GET as overviewRoute } from "@/app/api/admin/overview/route";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { AdminAgentRow, AdminAgentsResponse, AdminCpcvActionResponse, AdminOverviewResponse } from "@/lib/types/api";

import { adminFixtures, DAY, EUR, hasTestDb, noteIds, PROTOCOL_NOW, poolStats, position, txHash } from "./__tests__/fixtures";

const fx = adminFixtures("admin-actions-tests");
const nextNoteId = noteIds();

const post = (url: string, body: unknown = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const settle = (id: string) => settleRoute(post(`/api/admin/cpcv/${id}/settle`), params(id));
const cancel = (id: string) => cancelRoute(post(`/api/admin/cpcv/${id}/cancel`), params(id));
const writeOff = (id: string) => writeOffRoute(post(`/api/admin/agents/${id}/write-off`), params(id));

const GRACE_DEADLINE = PROTOCOL_NOW + 30 * DAY;

describe.skipIf(!hasTestDb)("admin actions and reads (test database)", () => {
  beforeAll(() => fx.cleanup());
  afterAll(() => fx.cleanup());

  beforeEach(() => {
    session.requireAdmin.mockReset().mockResolvedValue({ userId: "admin", email: "admin@explorador.ai", role: "ADMIN", passkeyVerified: true });
    chain.readPoolStats.mockReset().mockResolvedValue(poolStats());
    chain.readAgentPosition.mockReset().mockResolvedValue(position());
    chain.readNote.mockReset();
    for (const fn of [chain.settleNote, chain.cancelNote, chain.writeOff, chain.juniorDeposit, chain.juniorWithdraw, chain.claimFees, chain.advanceClock]) {
      fn.mockReset().mockImplementation(async () => ({ txHash: txHash(), ledger: 1, result: undefined }));
    }
    chain.getDeployment.mockReset().mockResolvedValue({
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      teurc: "CTEURC",
      cpcvNote: "CNOTE",
      advancePool: "CPOOL",
      explorerBase: "https://stellar.expert/explorer/testnet",
    });
    sweep.retryDraws.mockReset().mockResolvedValue({ ran: true, examined: 0, confirmed: 0, recovered: 0, failed: 0, skipped: 0 });
  });

  describe("confirm escritura and cancel", () => {
    it("settles an active note: MINTED → SETTLED with the tx hash, once", async () => {
      const agent = await fx.agent();
      const noteId = nextNoteId();
      const row = await fx.cpcv(agent.userId, { noteId });
      chain.settleNote.mockResolvedValueOnce({ txHash: "settle-tx", ledger: 5, result: undefined });

      const res = await settle(row.id);
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdminCpcvActionResponse;
      expect(body).toMatchObject({
        txHash: "settle-tx",
        explorerUrl: "https://stellar.expert/explorer/testnet/tx/settle-tx",
        cpcv: { id: row.id, status: "SETTLED", settleTxHash: "settle-tx", noteId, propertyAddress: "Rua Augusta 100, 1100-053 Lisboa" },
      });
      expect(chain.settleNote).toHaveBeenCalledWith(noteId);
      expect(await db.cpcv.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "SETTLED", settleTxHash: "settle-tx" });

      const again = await settle(row.id);
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ error: { code: "INVALID_STATUS", message: "Only active notes can be confirmed (this CPCV is settled)" } });
      expect(chain.settleNote).toHaveBeenCalledTimes(1);
    });

    it("cancels an active note: MINTED → CANCELLED with the tx hash", async () => {
      const agent = await fx.agent();
      const noteId = nextNoteId();
      const row = await fx.cpcv(agent.userId, { noteId });
      chain.cancelNote.mockResolvedValueOnce({ txHash: "cancel-tx", ledger: 5, result: undefined });

      const body = (await (await cancel(row.id)).json()) as AdminCpcvActionResponse;
      expect(body.cpcv).toMatchObject({ status: "CANCELLED", cancelTxHash: "cancel-tx" });
      expect(chain.cancelNote).toHaveBeenCalledWith(noteId);
      expect(await db.cpcv.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "CANCELLED", cancelTxHash: "cancel-tx", settleTxHash: null });
    });

    it("only acts on minted notes", async () => {
      const agent = await fx.agent();
      const failed = await fx.cpcv(agent.userId, { status: "FAILED" });
      const res = await cancel(failed.id);
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toBe("Only active notes can be cancelled (this CPCV is failed)");
      expect((await settle("missing-id")).status).toBe(404);
      expect(chain.cancelNote).not.toHaveBeenCalled();
    });

    it("syncs the row when the note already changed on-chain (LineNotActive)", async () => {
      const agent = await fx.agent();
      const noteId = nextNoteId();
      const row = await fx.cpcv(agent.userId, { noteId });
      chain.settleNote.mockRejectedValueOnce(new Error("HostError: Error(Contract, #9)"));
      chain.readNote.mockResolvedValueOnce({ id: noteId, status: "Cancelled" });

      const res = await settle(row.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "ALREADY_CANCELLED", message: `Note #${noteId} is already cancelled on-chain; the list now shows it.` },
      });
      expect(await db.cpcv.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "CANCELLED" });
    });

    it("leaves the row untouched when the transaction fails", async () => {
      const agent = await fx.agent();
      const row = await fx.cpcv(agent.userId, { noteId: nextNoteId() });
      chain.settleNote.mockRejectedValueOnce(new Error("tx failed: txBAD_SEQ"));
      const res = await settle(row.id);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error: { code: "CHAIN_ERROR", message: "Stellar call failed: tx failed: txBAD_SEQ" } });
      expect(await db.cpcv.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "MINTED", settleTxHash: null });
    });
  });

  describe("write-off", () => {
    it("refuses before the grace deadline (no transaction), then writes off and marks only that agent's cancelled CPCVs", async () => {
      const agent = await fx.agent();
      const other = await fx.agent();
      const cancelledA = await fx.cpcv(agent.userId, { status: "CANCELLED", noteId: nextNoteId() });
      const cancelledB = await fx.cpcv(agent.userId, { status: "CANCELLED", noteId: nextNoteId() });
      const settled = await fx.cpcv(agent.userId, { status: "SETTLED", noteId: nextNoteId() });
      const othersCancelled = await fx.cpcv(other.userId, { status: "CANCELLED", noteId: nextNoteId() });
      chain.readAgentPosition.mockResolvedValue(position({ carriedDebt: 2_000n * EUR, graceDeadline: BigInt(GRACE_DEADLINE) }));

      const early = await writeOff(agent.userId);
      expect(early.status).toBe(409);
      expect(await early.json()).toMatchObject({ error: { code: "GRACE_NOT_OVER", message: expect.stringContaining("24 Nov 2026") } });
      expect(chain.writeOff).not.toHaveBeenCalled();

      chain.readPoolStats.mockResolvedValue(poolStats({ protocolNow: BigInt(GRACE_DEADLINE + 60) }));
      chain.writeOff.mockResolvedValueOnce({ txHash: "writeoff-tx", ledger: 8, result: undefined });
      const res = await writeOff(agent.userId);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ txHash: "writeoff-tx", explorerUrl: "https://stellar.expert/explorer/testnet/tx/writeoff-tx", writtenOff: 2 });
      expect(chain.writeOff).toHaveBeenCalledWith(agent.smartAccount);

      const statuses = await db.cpcv.findMany({ where: { id: { in: [cancelledA.id, cancelledB.id, settled.id, othersCancelled.id] } }, select: { id: true, status: true } });
      expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
        [cancelledA.id]: "WRITTEN_OFF",
        [cancelledB.id]: "WRITTEN_OFF",
        [settled.id]: "SETTLED",
        [othersCancelled.id]: "CANCELLED",
      });
    });

    it("explains when there is nothing to write off, and maps contract errors when the pre-check can't read", async () => {
      const agent = await fx.agent();
      const none = await writeOff(agent.userId);
      expect(none.status).toBe(409);
      expect((await none.json()).error.code).toBe("NOTHING_TO_WRITE_OFF");

      chain.readAgentPosition.mockRejectedValue(new Error("rpc down"));
      chain.writeOff.mockRejectedValueOnce(new Error("Error(Contract, #10)"));
      const res = await writeOff(agent.userId);
      expect(await res.json()).toMatchObject({ error: { code: "GRACE_NOT_OVER", message: "The grace period has not ended yet" } });

      expect((await writeOff("missing")).status).toBe(404);
    });
  });

  describe("agents table and dashboard", () => {
    it("lists agents with their live position, the cache as fallback, and write-off availability", async () => {
      const pastGrace = await fx.agent();
      const inGrace = await fx.agent();
      const cachedOnly = await fx.agent({ cachedPosition: { totalDebt: "70000000", carriedDebt: "0", graceDeadline: null, blocked: true } });
      const onboarding = await fx.agent({ smartAccount: false });
      await fx.cpcv(pastGrace.userId, { status: "CANCELLED", noteId: nextNoteId() });
      await fx.cpcv(pastGrace.userId, { noteId: nextNoteId() });
      await fx.cpcv(pastGrace.userId, { status: "FAILED" });

      chain.readAgentPosition.mockImplementation(async (account: string) => {
        if (account === pastGrace.smartAccount) return position({ totalDebt: 2_100n * EUR, carriedDebt: 2_000n * EUR, graceDeadline: BigInt(PROTOCOL_NOW - DAY) });
        if (account === inGrace.smartAccount) return position({ totalDebt: 500n * EUR, carriedDebt: 500n * EUR, graceDeadline: BigInt(PROTOCOL_NOW + DAY) });
        throw new Error("rpc timeout");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await agentsRoute();
      warn.mockRestore();
      const body = (await res.json()) as AdminAgentsResponse;
      const byId = new Map<string, AdminAgentRow>(body.agents.map((a) => [a.id, a]));

      expect(byId.get(pastGrace.userId)).toEqual({
        id: pastGrace.userId,
        email: pastGrace.email,
        displayName: "Test Agent",
        smartAccount: pastGrace.smartAccount,
        cardLast4: "4242",
        cardEnabledOnChain: true,
        notes: 2,
        activeNotes: 1,
        debt: String(2_100n * EUR),
        carriedDebt: String(2_000n * EUR),
        graceDeadline: PROTOCOL_NOW - DAY,
        blocked: false,
        canWriteOff: true,
        positionSource: "chain",
      });
      expect(byId.get(inGrace.userId)).toMatchObject({ canWriteOff: false, carriedDebt: String(500n * EUR), positionSource: "chain" });
      expect(byId.get(cachedOnly.userId)).toMatchObject({ debt: "70000000", blocked: true, canWriteOff: false, positionSource: "cache" });
      expect(byId.get(onboarding.userId)).toMatchObject({ smartAccount: null, cardLast4: null, debt: "0", canWriteOff: false, positionSource: "none" });
      expect(body.clock).toMatchObject({ protocolNow: PROTOCOL_NOW });
    });

    it("overview: pool stats, unfunded card spends, agents past grace, deployment, and a retry sweep", async () => {
      const agent = await fx.agent();
      chain.readAgentPosition.mockImplementation(async (account: string) =>
        account === agent.smartAccount ? position({ carriedDebt: 2_000n * EUR, graceDeadline: BigInt(PROTOCOL_NOW - DAY) }) : position(),
      );
      const failedDraw = await db.cardAuthorization.create({
        data: { lithicToken: `sim_txn_${txHash()}`, agentId: agent.userId, amountCents: 34_900n, merchant: "Worten", decision: "APPROVED", chainStatus: "FAILED", attempts: 3 },
      });
      await db.cardAuthorization.create({
        data: { lithicToken: `sim_txn_${txHash()}`, agentId: agent.userId, amountCents: 480n, merchant: "Pastelaria Aloma", decision: "APPROVED", chainStatus: "CONFIRMED", attempts: 1 },
      });

      const res = await overviewRoute();
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdminOverviewResponse;
      expect(body.failedDraws).toContainEqual({
        id: failedDraw.id,
        agentEmail: agent.email,
        merchant: "Worten",
        amount: String(349n * EUR),
        attempts: 3,
        createdAt: failedDraw.createdAt.toISOString(),
      });
      expect(body.failedDraws.some((d) => d.merchant === "Pastelaria Aloma" && d.agentEmail === agent.email)).toBe(false);
      expect(body.agentsPastGrace.map((a) => a.id)).toContain(agent.userId);
      expect(body.deployment).toMatchObject({ advancePool: "CPOOL" });
      expect(body.clock).toMatchObject({ protocolNow: PROTOCOL_NOW, offsetSecs: expect.any(Number), demoMode: true });
      expect(body.stats).toMatchObject({ juniorAssets: String(10_000n * EUR), params: { maxLeverage: 10 } });
      expect(body.warnings).toEqual([]);
      await vi.waitFor(() => expect(sweep.retryDraws).toHaveBeenCalledTimes(1));
    });

    it("overview still renders when the chain and deployment can't be read", async () => {
      chain.readPoolStats.mockRejectedValue(new Error("rpc down"));
      chain.getDeployment.mockRejectedValue(new HttpError(501, "NOT_IMPLEMENTED", "getDeployment is not implemented yet"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = (await (await overviewRoute()).json()) as AdminOverviewResponse;
      warn.mockRestore();
      expect(body.stats).toBeNull();
      expect(body.deployment).toBeNull();
      expect(body.warnings).toEqual(["Pool stats unavailable: rpc down", "Deployment unavailable: getDeployment is not implemented yet"]);
      expect(body.agentsPastGrace).toEqual([]);
    });
  });

  describe("treasury and demo clock", () => {
    it("runs junior deposit / withdraw and fee claims in stroops, with readable contract errors", async () => {
      chain.juniorDeposit.mockResolvedValueOnce({ txHash: "dep-tx", ledger: 1, result: undefined });
      const dep = await juniorDepositRoute(post("/api/admin/junior/deposit", { amountEur: 1_234.56 }));
      expect(await dep.json()).toEqual({ txHash: "dep-tx", explorerUrl: "https://stellar.expert/explorer/testnet/tx/dep-tx" });
      expect(chain.juniorDeposit).toHaveBeenCalledWith(12_345_600_000n);

      chain.juniorWithdraw.mockRejectedValueOnce(new Error("Error(Contract, #6)"));
      const withdraw = await juniorWithdrawRoute(post("/api/admin/junior/withdraw", { amountEur: 9_000 }));
      expect(withdraw.status).toBe(409);
      expect(await withdraw.json()).toEqual({
        error: { code: "LEVERAGE_CAP_EXCEEDED", message: "Withdrawing this much would push outstanding debt above 10× the junior tranche" },
      });

      await claimFeesRoute(post("/api/admin/fees/claim", { amountEur: 8.88 }));
      expect(chain.claimFees).toHaveBeenCalledWith(88_800_000n);

      for (const bad of [{ amountEur: 0 }, { amountEur: -5 }, { amountEur: 1.234 }, { amountEur: "10" }, {}]) {
        const res = await juniorDepositRoute(post("/api/admin/junior/deposit", bad));
        expect(res.status).toBe(400);
      }
    });

    it("advances the clock by days or to an agent's grace deadline", async () => {
      chain.readPoolStats.mockResolvedValue(poolStats({ protocolNow: BigInt(PROTOCOL_NOW) }));
      const res = await advanceClockRoute(post("/api/admin/demo/advance-clock", { days: 30 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ txHash: expect.any(String), clock: { protocolNow: PROTOCOL_NOW, demoMode: true } });
      expect(chain.advanceClock).toHaveBeenCalledWith(30 * DAY);

      const agent = await fx.agent();
      chain.readAgentPosition.mockResolvedValue(position({ carriedDebt: 2_000n * EUR, graceDeadline: BigInt(GRACE_DEADLINE) }));
      await advanceClockRoute(post("/api/admin/demo/advance-clock", { toGraceDeadlineOf: agent.userId }));
      expect(chain.advanceClock).toHaveBeenLastCalledWith(GRACE_DEADLINE - PROTOCOL_NOW + 60);

      chain.readAgentPosition.mockResolvedValue(position());
      const none = await advanceClockRoute(post("/api/admin/demo/advance-clock", { toGraceDeadlineOf: agent.userId }));
      expect(none.status).toBe(409);
      expect((await none.json()).error.code).toBe("NO_GRACE_PERIOD");

      for (const bad of [{ days: 0 }, { days: 401 }, { days: 1.5 }, { days: 1, toGraceDeadlineOf: agent.userId }, {}]) {
        expect((await advanceClockRoute(post("/api/admin/demo/advance-clock", bad))).status).toBe(400);
      }
      expect(chain.advanceClock).toHaveBeenCalledTimes(2);
    });
  });
});
