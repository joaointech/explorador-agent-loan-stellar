// POST /api/admin/cpcv (the CPCV → proof → note pipeline over SSE) and the
// CPCV reads, against the test database. Proving, the chain and the session
// are mocked.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY = "11".repeat(32);
  process.env.ATTESTER_EDDSA_PRIVKEY = "22".repeat(32);
  process.env.NULLIFIER_SECRET = "12345";
  process.env.DEMO_MODE = "true";
});

const chain = vi.hoisted(() => ({
  readProtocolNow: vi.fn(),
  readPoolStats: vi.fn(),
  readAgentPosition: vi.fn(),
  readLine: vi.fn(),
  mintNote: vi.fn(),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));
vi.mock("@/lib/stellar/contracts", () => chain);

const zk = vi.hoisted(() => ({ proveCpcv: vi.fn() }));
vi.mock("@/lib/zk/prove", () => zk);

const session = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

import { GET as getDetail } from "@/app/api/admin/cpcv/[id]/route";
import { GET as list, POST as create } from "@/app/api/admin/cpcv/route";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { AdminCpcvDetailResponse, AdminCpcvInput, AdminCpcvListResponse, PipelineEvent } from "@/lib/types/api";
import type { ProveStep } from "@/lib/zk/prove";

import { adminFixtures, EUR, fakeProof, hasTestDb, noteIds, PROTOCOL_DAY, PROTOCOL_NOW, poolStats, position, txHash } from "./__tests__/fixtures";
import { decryptCpcvPii } from "./pii";
import { readSseEvents } from "./sse-parser";

const fx = adminFixtures("admin-pipeline-tests");
const nextNoteId = noteIds();

const input = (agentId: string, over: Partial<AdminCpcvInput> = {}): AdminCpcvInput => ({
  agentId,
  buyerName: "Maria Silva",
  buyerNif: "123456789",
  sellerName: "João Pereira",
  sellerNif: "987654321",
  propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
  salePriceCents: 30_000_000,
  commissionRateBps: 500,
  cpcvDate: "2026-10-20",
  escrituraDate: "2027-01-23",
  ...over,
});

const post = (body: unknown, contentType = "application/json") =>
  new Request("http://localhost/api/admin/cpcv", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function run(body: unknown): Promise<{ res: Response; events: PipelineEvent[] }> {
  const res = await create(post(body));
  const events: PipelineEvent[] = [];
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) await readSseEvents<PipelineEvent>(res, (e) => events.push(e));
  return { res, events };
}

const steps = (events: PipelineEvent[]) => events.map((e) => `${e.step}:${e.status}`);

/** proveCpcv stand-in that reports the real steps, then returns `proof` (or throws at `failAt`). */
function proving(proof = fakeProof(), failAt?: ProveStep, error = new Error("witness does not satisfy the constraints")) {
  return async (_agent: string, _input: unknown, onStep?: (s: ProveStep) => void) => {
    for (const step of ["signing", "proving", "verifying"] as const) {
      onStep?.(step);
      if (step === failAt) throw error;
    }
    return proof;
  };
}

describe.skipIf(!hasTestDb)("CPCV pipeline and reads (test database)", () => {
  beforeAll(() => fx.cleanup());
  afterAll(() => fx.cleanup());

  beforeEach(() => {
    session.requireAdmin.mockReset().mockResolvedValue({ userId: "admin", email: "admin@explorador.ai", role: "ADMIN", passkeyVerified: true });
    chain.readProtocolNow.mockReset().mockResolvedValue(BigInt(PROTOCOL_NOW));
    chain.readPoolStats.mockReset().mockResolvedValue(poolStats());
    chain.readAgentPosition.mockReset().mockResolvedValue(position());
    chain.readLine.mockReset();
    chain.mintNote.mockReset().mockImplementation(async () => ({ txHash: txHash(), ledger: 1, result: nextNoteId() }));
    zk.proveCpcv.mockReset().mockImplementation(proving());
  });

  it("validates, proves, mints and records the note, streaming every step", async () => {
    const agent = await fx.agent();
    const proof = fakeProof();
    zk.proveCpcv.mockImplementation(proving(proof));
    const noteId = nextNoteId();
    const hash = txHash();
    chain.mintNote.mockResolvedValueOnce({ txHash: hash, ledger: 9, result: noteId });

    const { res, events } = await run(input(agent.userId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(steps(events)).toEqual([
      "validating:started",
      "validating:completed",
      "signing:started",
      "signing:completed",
      "proving:started",
      "proving:completed",
      "verifying:started",
      "verifying:completed",
      "minting:started",
      "minting:completed",
      "done:completed",
    ]);

    const cpcvId = events[1].data!.cpcvId as string;
    expect(events[1].data).toMatchObject({
      totalCommission: String(15_000n * EUR),
      agentCommission: String(7_500n * EUR),
      exploradorCommission: String(7_500n * EUR),
      creditLimit: String(3_750n * EUR),
    });
    expect(events.at(-1)).toMatchObject({
      step: "done",
      data: { cpcvId, noteId, txHash: hash, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${hash}`, registryUrl: `/registry/${noteId}` },
    });

    expect(zk.proveCpcv).toHaveBeenCalledWith(
      agent.smartAccount,
      {
        buyerNif: "123456789",
        sellerNif: "987654321",
        salePriceCents: 30_000_000n,
        commissionRateBps: 500,
        propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
        cpcvDay: PROTOCOL_DAY - 5,
        escrituraDay: PROTOCOL_DAY + 90,
      },
      expect.any(Function),
    );
    expect(chain.mintNote).toHaveBeenCalledWith({
      to: agent.smartAccount,
      proof: proof.sorobanProof,
      totalCommissionCents: 1_500_000n,
      escrituraDay: PROTOCOL_DAY + 90,
      commitment: proof.commitment,
      nullifier: proof.nullifier,
    });

    const row = await db.cpcv.findUniqueOrThrow({ where: { id: cpcvId } });
    expect(row).toMatchObject({
      agentId: agent.userId,
      status: "MINTED",
      noteId,
      mintTxHash: hash,
      error: null,
      totalCommissionCents: 1_500_000n,
      agentCommissionCents: 750_000n,
      escrituraDay: PROTOCOL_DAY + 90,
      commitment: Buffer.from(proof.commitment).toString("hex"),
      nullifier: Buffer.from(proof.nullifier).toString("hex"),
      proof: { proof: proof.snarkjsProof, publicSignals: proof.publicSignals },
    });
    // PII, including the proof's salt, is stored only encrypted.
    expect(Buffer.from(row.piiEncrypted).toString("utf8")).not.toContain("Maria");
    expect(decryptCpcvPii(row.piiEncrypted)).toEqual({
      v: 1,
      buyerName: "Maria Silva",
      buyerNif: "123456789",
      sellerName: "João Pereira",
      sellerNif: "987654321",
      propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
      salePriceCents: 30_000_000,
      commissionRateBps: 500,
      cpcvDate: "2026-10-20",
      cpcvDay: PROTOCOL_DAY - 5,
      salt: proof.salt,
    });
  });

  it("marks the CPCV FAILED when proving fails, and mints nothing", async () => {
    const agent = await fx.agent();
    zk.proveCpcv.mockImplementation(proving(fakeProof(), "proving"));

    const { events } = await run(input(agent.userId));
    expect(steps(events)).toEqual(["validating:started", "validating:completed", "signing:started", "signing:completed", "proving:started", "proving:failed"]);
    const failed = events.at(-1)!;
    expect(failed.message).toBe("Proof generation failed: witness does not satisfy the constraints");
    expect(chain.mintNote).not.toHaveBeenCalled();

    const row = await db.cpcv.findUniqueOrThrow({ where: { id: failed.data!.cpcvId as string } });
    expect(row).toMatchObject({ status: "FAILED", error: "Proof generation failed: witness does not satisfy the constraints", noteId: null, commitment: "" });
  });

  it("marks the CPCV FAILED with a readable reason when the mint is rejected on-chain", async () => {
    const agent = await fx.agent();
    const proof = fakeProof();
    zk.proveCpcv.mockImplementation(proving(proof));
    chain.mintNote.mockRejectedValueOnce(new Error("transaction simulation failed: HostError: Error(Contract, #13)"));

    const { events } = await run(input(agent.userId));
    expect(steps(events).slice(-2)).toEqual(["minting:started", "minting:failed"]);
    expect(events.at(-1)).toMatchObject({ message: "The note contract rejected the zero-knowledge proof", data: { code: "INVALID_PROOF" } });

    const row = await db.cpcv.findUniqueOrThrow({ where: { id: events.at(-1)!.data!.cpcvId as string } });
    // The proof was kept for inspection.
    expect(row).toMatchObject({ status: "FAILED", error: "The note contract rejected the zero-knowledge proof", nullifier: Buffer.from(proof.nullifier).toString("hex") });
    expect(row.proof).not.toBeNull();
  });

  it("refuses to finance the same CPCV twice (same nullifier) before sending a transaction", async () => {
    const agent = await fx.agent();
    const proof = fakeProof();
    zk.proveCpcv.mockImplementation(proving(proof));
    const first = await run(input(agent.userId));
    expect(first.events.at(-1)!.step).toBe("done");
    const noteId = first.events.at(-1)!.data!.noteId;

    zk.proveCpcv.mockImplementation(proving(fakeProof({ nullifier: proof.nullifier })));
    const second = await run(input(agent.userId));
    expect(second.events.at(-1)).toMatchObject({ step: "minting", status: "failed", message: `This CPCV was already financed as note #${noteId}`, data: { code: "ALREADY_FINANCED" } });
    expect(chain.mintNote).toHaveBeenCalledTimes(1);
  });

  it("fails validation without creating a row: no smart account, unknown agent, escritura not after the protocol date", async () => {
    const onboarding = await fx.agent({ smartAccount: false });
    const ready = await fx.agent();
    const before = await db.cpcv.count({ where: { agentId: { in: [onboarding.userId, ready.userId] } } });

    const noAccount = await run(input(onboarding.userId));
    expect(noAccount.events).toEqual([
      { step: "validating", status: "started", message: expect.any(String) },
      { step: "validating", status: "failed", message: `${onboarding.email} has no smart account yet: they need to finish onboarding first`, data: { code: "AGENT_NOT_READY" } },
    ]);

    const unknown = await run(input("no-such-user"));
    expect(unknown.events.at(-1)).toMatchObject({ step: "validating", status: "failed", data: { code: "UNKNOWN_AGENT" } });

    // The demo clock moved past the escritura date.
    chain.readProtocolNow.mockResolvedValue(BigInt((PROTOCOL_DAY + 120) * 86_400));
    const late = await run(input(ready.userId));
    expect(late.events.at(-1)).toMatchObject({
      step: "validating",
      status: "failed",
      message: "The escritura must be after today's protocol date (22 Feb 2027)",
      data: { code: "INVALID_DATE" },
    });

    expect(zk.proveCpcv).not.toHaveBeenCalled();
    expect(await db.cpcv.count({ where: { agentId: { in: [onboarding.userId, ready.userId] } } })).toBe(before);
  });

  it("rejects malformed bodies, non-JSON posts and non-admins with JSON errors before streaming", async () => {
    const agent = await fx.agent();
    const bad = await create(post({ ...input(agent.userId), buyerNif: "12345" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", message: expect.stringContaining("buyerNif") } });

    const textPlain = await create(post(input(agent.userId), "text/plain"));
    expect(textPlain.status).toBe(415);

    session.requireAdmin.mockRejectedValue(new HttpError(403, "FORBIDDEN", "This is only available to admins"));
    const forbidden = await create(post(input(agent.userId)));
    expect(forbidden.status).toBe(403);
    expect(zk.proveCpcv).not.toHaveBeenCalled();
  });

  it("lists CPCVs with decrypted PII and flags overdue notes; the detail adds proof, line and position", async () => {
    const agent = await fx.agent();
    const noteId = nextNoteId();
    const overdue = await fx.cpcv(agent.userId, { noteId, escrituraDay: PROTOCOL_DAY - 1, pii: { propertyAddress: "Avenida dos Aliados 1, Porto" } });
    const settled = await fx.cpcv(agent.userId, { status: "SETTLED", noteId: nextNoteId(), escrituraDay: PROTOCOL_DAY - 30 });
    await db.cpcv.update({ where: { id: settled.id }, data: { createdAt: new Date(Date.now() + 1_000) } });
    await db.cpcv.update({ where: { id: overdue.id }, data: { proof: { proof: fakeProof().snarkjsProof, publicSignals: ["1", "2"] } as never } });

    const res = await list();
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminCpcvListResponse;
    expect(body.clock).toMatchObject({ protocolNow: PROTOCOL_NOW, demoMode: true });
    const mine = body.cpcvs.filter((c) => c.agent.id === agent.userId);
    expect(mine.map((c) => c.id)).toEqual([settled.id, overdue.id]); // newest first
    expect(mine[1]).toMatchObject({
      agent: { id: agent.userId, email: agent.email, smartAccount: agent.smartAccount },
      propertyAddress: "Avenida dos Aliados 1, Porto",
      buyerName: "Maria Silva",
      buyerNif: "123456789",
      salePriceCents: 30_000_000,
      commissionRateBps: 500,
      cpcvDay: PROTOCOL_DAY - 5,
      totalCommission: String(15_000n * EUR),
      agentCommission: String(7_500n * EUR),
      status: "MINTED",
      noteId,
      overdue: true,
    });
    expect(mine[0]).toMatchObject({ status: "SETTLED", overdue: false });
    expect(mine[1].piiUnavailable).toBeUndefined();

    chain.readLine.mockResolvedValue({
      line: { noteId, agent: agent.smartAccount, creditLimit: 3_750n * EUR, principal: 3_000n * EUR, scaledDebt: 0n, escrituraDay: PROTOCOL_DAY - 1, status: "Active" },
      debt: 3_088_7700_000n,
      interest: 88_7700_000n,
      available: 661_2300_000n,
    });
    chain.readAgentPosition.mockResolvedValue(position({ carriedDebt: 500n * EUR, cardBalance: 20n * EUR, graceDeadline: BigInt(PROTOCOL_NOW + 100 * 86_400) }));
    const detailRes = await getDetail(new Request(`http://localhost/api/admin/cpcv/${overdue.id}`), { params: Promise.resolve({ id: overdue.id }) });
    const detail = (await detailRes.json()) as AdminCpcvDetailResponse;
    expect(detail).toMatchObject({
      cpcv: { id: overdue.id, overdue: true },
      commitment: overdue.commitment,
      salt: "0f".repeat(32),
      proof: { proof: { pi_a: ["11", "12", "1"], protocol: "groth16", curve: "bn128" }, publicSignals: ["1", "2"] },
      line: { creditLimit: String(3_750n * EUR), debt: "30887700000", interest: "887700000", available: "6612300000", principal: String(3_000n * EUR) },
      agentPosition: { carriedDebt: String(500n * EUR), cardBalance: String(20n * EUR), graceDeadline: PROTOCOL_NOW + 100 * 86_400 },
    });
    expect(chain.readLine).toHaveBeenCalledWith(noteId);

    const missing = await getDetail(new Request("http://localhost/api/admin/cpcv/nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(404);
  });

  it("still lists rows whose PII can't be decrypted", async () => {
    const agent = await fx.agent();
    const row = await fx.cpcv(agent.userId, { status: "FAILED" });
    await db.cpcv.update({ where: { id: row.id }, data: { piiEncrypted: new Uint8Array(40) } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = (await (await list()).json()) as AdminCpcvListResponse;
    warn.mockRestore();
    expect(body.cpcvs.find((c) => c.id === row.id)).toMatchObject({ piiUnavailable: true, propertyAddress: "", buyerName: "" });
  });
});
