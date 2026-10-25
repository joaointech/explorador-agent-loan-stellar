// The signed CPCV PDF against the test database: the upload is stored
// encrypted (with Claude's reading, mocked here), the CPCV pipeline links it
// to the new deal (and refuses one already linked), "View PDF" serves it back
// decrypted, and unused uploads are purged after 24 h. Proving, the chain,
// the session and the Claude call are mocked.

import { randomUUID } from "node:crypto";

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

const claude = vi.hoisted(() => ({ extractCpcvFromPdf: vi.fn() }));
vi.mock("@/lib/admin/cpcv-extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/cpcv-extract")>()),
  extractCpcvFromPdf: claude.extractCpcvFromPdf,
}));

import { GET as viewPdf } from "@/app/api/admin/cpcv/[id]/document/route";
import { POST as uploadRoute } from "@/app/api/admin/cpcv/documents/route";
import { GET as list, POST as create } from "@/app/api/admin/cpcv/route";
import { decryptBytes, decryptJson, sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { AdminCpcvDocumentResponse, AdminCpcvInput, AdminCpcvListResponse, CpcvExtraction, PipelineEvent } from "@/lib/types/api";
import type { ProveStep } from "@/lib/zk/prove";

import { adminFixtures, fakeProof, hasTestDb, noteIds, PROTOCOL_NOW, poolStats, position, txHash } from "./__tests__/fixtures";
import { purgeStaleCpcvDocuments, UNLINKED_UPLOAD_TTL_MS } from "./cpcv-documents";
import { UPLOAD_HEADER } from "./document-upload";
import { readSseEvents } from "./sse-parser";

const fx = adminFixtures("admin-cpcv-documents-tests");
const nextNoteId = noteIds();

const PDF = new TextEncoder().encode("%PDF-1.7\n% CPCV de teste: Maria Exemplo Silva, NIF 123456789\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

const extraction: CpcvExtraction = {
  fields: {
    buyerName: { value: "Maria Exemplo Silva", confidence: "high", note: null, warnings: [] },
    buyerNif: { value: "123456789", confidence: "high", note: null, warnings: [] },
    sellerName: { value: "João Fictício Pereira", confidence: "high", note: null, warnings: [] },
    sellerNif: { value: "987654321", confidence: "high", note: null, warnings: ["Seller NIF 987654321 fails the Portuguese check digit (mod 11): compare it with the contract."] },
    propertyAddress: { value: "Rua Augusta 100, 1100-053 Lisboa", confidence: "high", note: null, warnings: [] },
    salePriceCents: { value: 30_000_000, confidence: "high", note: null, warnings: [] },
    cpcvDate: { value: "2026-10-20", confidence: "high", note: null, warnings: [] },
    escrituraDate: { value: "2027-01-18", confidence: "medium", note: "Computed as the signing date + 90 days.", warnings: [] },
    commissionRateBps: { value: null, confidence: "high", note: "Not stated.", warnings: [] },
  },
  warnings: [],
  model: "claude-opus-5-5",
};

let admin: { id: string; email: string };

function uploadRequest(bytes: Uint8Array = PDF, name = "CPCV Maria \"Exemplo\".pdf") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
  return new Request("http://localhost/api/admin/cpcv/documents", { method: "POST", headers: { [UPLOAD_HEADER]: "1" }, body: form });
}

async function upload(bytes: Uint8Array = PDF): Promise<AdminCpcvDocumentResponse> {
  const res = await uploadRoute(uploadRequest(bytes));
  expect(res.status).toBe(201);
  return (await res.json()) as AdminCpcvDocumentResponse;
}

const input = (agentId: string, over: Partial<AdminCpcvInput> = {}): AdminCpcvInput => ({
  agentId,
  buyerName: "Maria Exemplo Silva",
  buyerNif: "123456789",
  sellerName: "João Fictício Pereira",
  sellerNif: "987654321",
  propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
  salePriceCents: 30_000_000,
  commissionRateBps: 500,
  cpcvDate: "2026-10-20",
  escrituraDate: "2027-01-23",
  ...over,
});

async function runPipeline(body: AdminCpcvInput): Promise<PipelineEvent[]> {
  const res = await create(new Request("http://localhost/api/admin/cpcv", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const events: PipelineEvent[] = [];
  await readSseEvents<PipelineEvent>(res, (e) => events.push(e));
  return events;
}

function proving(failAt?: ProveStep) {
  return async (_agent: string, _input: unknown, onStep?: (s: ProveStep) => void) => {
    for (const step of ["signing", "proving", "verifying"] as const) {
      onStep?.(step);
      if (step === failAt) throw new Error("witness does not satisfy the constraints");
    }
    return fakeProof();
  };
}

const documentOf = (id: string) => db.cpcvDocument.findUniqueOrThrow({ where: { id } });
const viewRequest = (cpcvId: string) => viewPdf(new Request(`http://localhost/api/admin/cpcv/${cpcvId}/document`), { params: Promise.resolve({ id: cpcvId }) });

async function cleanup() {
  await db.cpcvDocument.deleteMany({ where: { uploadedBy: { email: { endsWith: `@${fx.domain}` } } } });
  await fx.cleanup();
}

describe.skipIf(!hasTestDb)("signed CPCV PDF (test database)", () => {
  beforeAll(async () => {
    await cleanup();
    const user = await db.user.create({ data: { email: `admin-${randomUUID()}@${fx.domain}`, role: "ADMIN" } });
    admin = { id: user.id, email: user.email };
  });
  afterAll(() => cleanup());

  beforeEach(() => {
    session.requireAdmin.mockReset().mockResolvedValue({ userId: admin.id, email: admin.email, role: "ADMIN", passkeyVerified: true });
    claude.extractCpcvFromPdf.mockReset().mockResolvedValue({ ok: true, extraction });
    chain.readProtocolNow.mockReset().mockResolvedValue(BigInt(PROTOCOL_NOW));
    chain.readPoolStats.mockReset().mockResolvedValue(poolStats());
    chain.readAgentPosition.mockReset().mockResolvedValue(position());
    chain.mintNote.mockReset().mockImplementation(async () => ({ txHash: txHash(), ledger: 1, result: nextNoteId() }));
    zk.proveCpcv.mockReset().mockImplementation(proving());
  });

  it("stores the upload encrypted at rest, with Claude's reading, and answers with the prefill", async () => {
    const body = await upload();
    expect(body).toEqual({
      documentId: expect.any(String),
      fileName: "CPCV Maria Exemplo.pdf",
      sizeBytes: PDF.length,
      sha256: sha256Hex(PDF),
      extraction,
    });
    expect(claude.extractCpcvFromPdf).toHaveBeenCalledWith(PDF, { signal: expect.any(AbortSignal) });

    const row = await documentOf(body.documentId);
    expect(row).toMatchObject({ uploadedById: admin.id, fileName: "CPCV Maria Exemplo.pdf", sizeBytes: PDF.length, sha256: sha256Hex(PDF), cpcvId: null, extractionError: null });
    // Neither the PDF nor the reading is readable in the database.
    const stored = Buffer.from(row.contentEncrypted);
    expect(stored.includes(Buffer.from("%PDF"))).toBe(false);
    expect(stored.includes(Buffer.from("Maria"))).toBe(false);
    expect(Buffer.from(decryptBytes(row.contentEncrypted)).equals(Buffer.from(PDF))).toBe(true);
    expect(Buffer.from(row.extractionEncrypted!).includes(Buffer.from("Maria"))).toBe(false);
    expect(decryptJson(row.extractionEncrypted!)).toEqual(extraction);
  });

  it("still stores the PDF when the AI prefill is off or fails, and says why", async () => {
    const error = { code: "AI_NOT_CONFIGURED" as const, message: "AI prefill unavailable: ANTHROPIC_API_KEY is not set on this server. The PDF is stored; fill the form manually." };
    claude.extractCpcvFromPdf.mockResolvedValue({ ok: false, error });
    const body = await upload();
    expect(body).toMatchObject({ extraction: null, extractionError: error });
    expect(await documentOf(body.documentId)).toMatchObject({ extractionEncrypted: null, extractionError: "AI_NOT_CONFIGURED", sizeBytes: PDF.length });
  });

  it("links the PDF to the CPCV it was uploaded for, lists it, and serves it back decrypted", async () => {
    const agent = await fx.agent();
    const { documentId } = await upload();

    const events = await runPipeline(input(agent.userId, { documentId }));
    expect(events.at(-1)).toMatchObject({ step: "done", status: "completed" });
    expect(events[1].message).toContain("signed PDF attached");
    const cpcvId = events.at(-1)!.data!.cpcvId as string;
    expect(await documentOf(documentId)).toMatchObject({ cpcvId });

    const listed = ((await (await list()).json()) as AdminCpcvListResponse).cpcvs.find((c) => c.id === cpcvId);
    expect(listed?.document).toEqual({ fileName: "CPCV Maria Exemplo.pdf", sizeBytes: PDF.length, uploadedAt: expect.any(String) });

    const res = await viewRequest(cpcvId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="CPCV Maria Exemplo.pdf"; filename*=UTF-8''CPCV%20Maria%20Exemplo.pdf`);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PDF))).toBe(true);
  });

  it("refuses a PDF that already belongs to another CPCV, before writing anything", async () => {
    const agent = await fx.agent();
    const { documentId } = await upload();
    const first = await runPipeline(input(agent.userId, { documentId }));
    const noteId = first.at(-1)!.data!.noteId as number;
    const before = await db.cpcv.count({ where: { agentId: agent.userId } });

    const second = await runPipeline(input(agent.userId, { documentId, buyerNif: "234567899" }));
    expect(second.at(-1)).toMatchObject({
      step: "validating",
      status: "failed",
      message: `This PDF is already attached to another CPCV (note #${noteId}): upload the signed CPCV of this deal`,
      data: { code: "DOCUMENT_ALREADY_LINKED" },
    });
    expect(await db.cpcv.count({ where: { agentId: agent.userId } })).toBe(before);
    expect(await documentOf(documentId)).toMatchObject({ cpcvId: first.at(-1)!.data!.cpcvId });
  });

  it("moves the PDF of a FAILED CPCV to its retry", async () => {
    const agent = await fx.agent();
    const { documentId } = await upload();

    zk.proveCpcv.mockImplementation(proving("proving"));
    const failed = await runPipeline(input(agent.userId, { documentId }));
    const failedId = failed.at(-1)!.data!.cpcvId as string;
    expect(failed.at(-1)).toMatchObject({ step: "proving", status: "failed" });
    expect(await documentOf(documentId)).toMatchObject({ cpcvId: failedId });
    expect((await viewRequest(failedId)).status).toBe(200);

    zk.proveCpcv.mockImplementation(proving());
    const retry = await runPipeline(input(agent.userId, { documentId }));
    const retryId = retry.at(-1)!.data!.cpcvId as string;
    expect(retry.at(-1)).toMatchObject({ step: "done", status: "completed" });
    expect(await documentOf(documentId)).toMatchObject({ cpcvId: retryId });
    expect((await viewRequest(failedId)).status).toBe(404);
  });

  it("reports an unknown or expired upload", async () => {
    const agent = await fx.agent();
    const events = await runPipeline(input(agent.userId, { documentId: "no-such-document" }));
    expect(events.at(-1)).toMatchObject({ step: "validating", status: "failed", data: { code: "UNKNOWN_DOCUMENT" } });
    expect(events.at(-1)!.message).toMatch(/upload it again/);
  });

  it("works without a PDF, as before", async () => {
    const agent = await fx.agent();
    const events = await runPipeline(input(agent.userId));
    const cpcvId = events.at(-1)!.data!.cpcvId as string;
    expect(events.at(-1)).toMatchObject({ step: "done" });
    const listed = ((await (await list()).json()) as AdminCpcvListResponse).cpcvs.find((c) => c.id === cpcvId);
    expect(listed?.document).toBeNull();

    const res = await viewRequest(cpcvId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "This CPCV has no signed PDF" } });
  });

  it("purges unlinked uploads older than 24 h, and deletes a CPCV's PDF with the CPCV", async () => {
    const agent = await fx.agent();
    const stale = await upload();
    const fresh = await upload();
    const linked = await upload();
    const events = await runPipeline(input(agent.userId, { documentId: linked.documentId }));
    const cpcvId = events.at(-1)!.data!.cpcvId as string;
    const longAgo = new Date(Date.now() - UNLINKED_UPLOAD_TTL_MS - 60_000);
    await db.cpcvDocument.updateMany({ where: { id: { in: [stale.documentId, linked.documentId] } }, data: { createdAt: longAgo } });

    expect(await purgeStaleCpcvDocuments()).toBeGreaterThanOrEqual(1);
    expect(await db.cpcvDocument.findUnique({ where: { id: stale.documentId } })).toBeNull();
    expect(await db.cpcvDocument.findUnique({ where: { id: fresh.documentId } })).not.toBeNull();
    expect(await db.cpcvDocument.findUnique({ where: { id: linked.documentId } })).not.toBeNull();

    // A demo reset deletes CPCVs: their PDFs go with them.
    await db.cpcv.delete({ where: { id: cpcvId } });
    expect(await db.cpcvDocument.findUnique({ where: { id: linked.documentId } })).toBeNull();
  });
});
