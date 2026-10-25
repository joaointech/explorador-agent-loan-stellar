// The CPCV pipeline with the real prover (snarkjs + the committed circuit
// artifacts) against the test database; only the mint transaction and the
// session are mocked. The note the pipeline would mint must verify exactly as
// the registry re-verifies it from on-chain data (spec §8.5).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_KEYS = vi.hoisted(() => {
  const keys = {
    attesterPrivKey: "a1".repeat(32),
    nullifierSecret: "24832862275159723283241326441814195924414518770204777827089555393853918734",
  };
  process.env.ATTESTER_EDDSA_PRIVKEY = keys.attesterPrivKey;
  process.env.NULLIFIER_SECRET = keys.nullifierSecret;
  process.env.PII_ENCRYPTION_KEY = "44".repeat(32);
  return keys;
});

const chain = vi.hoisted(() => ({
  readProtocolNow: vi.fn(),
  mintNote: vi.fn(),
  explorerUrl: (kind: string, id: string) => `https://stellar.expert/explorer/testnet/${kind}/${id}`,
}));
vi.mock("@/lib/stellar/contracts", () => chain);

const session = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

import { POST as create } from "@/app/api/admin/cpcv/route";
import { db } from "@/lib/db";
import type { PipelineEvent } from "@/lib/types/api";
import { loadVerificationKey } from "@/lib/zk/artifacts";
import { proofToHex, type SorobanProof } from "@/lib/zk/format";
import { attesterParams } from "@/lib/zk/keys";
import { releaseZkResources } from "@/lib/zk/prove";
import { verifyNoteProof } from "@/lib/zk/verify";

import { adminFixtures, hasTestDb, noteIds, PROTOCOL_DAY, PROTOCOL_NOW, txHash } from "./__tests__/fixtures";
import { decryptCpcvPii } from "./pii";
import { readSseEvents } from "./sse-parser";

const fx = adminFixtures("admin-prove-tests");
const nextNoteId = noteIds();

describe.skipIf(!hasTestDb)("CPCV pipeline with the real prover (test database)", () => {
  beforeAll(() => fx.cleanup());
  afterAll(async () => {
    await fx.cleanup();
    await releaseZkResources();
  });

  it("produces a note that verifies from on-chain data alone", { timeout: 60_000 }, async () => {
    session.requireAdmin.mockResolvedValue({ userId: "admin", email: "admin@explorador.ai", role: "ADMIN", passkeyVerified: true });
    chain.readProtocolNow.mockResolvedValue(BigInt(PROTOCOL_NOW));
    const noteId = nextNoteId();
    chain.mintNote.mockResolvedValue({ txHash: txHash(), ledger: 1, result: noteId });
    const agent = await fx.agent();

    const res = await create(
      new Request("http://localhost/api/admin/cpcv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: agent.userId,
          buyerName: "Maria Silva",
          buyerNif: "123456789",
          sellerName: "João Pereira",
          sellerNif: "987654321",
          propertyAddress: "Rua  Augusta 100,\n1100-053 LISBOA",
          salePriceCents: 30_000_000,
          commissionRateBps: 500,
          cpcvDate: "2026-10-25",
          escrituraDate: "2027-01-23",
        }),
      }),
    );
    const events: PipelineEvent[] = [];
    await readSseEvents<PipelineEvent>(res, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ step: "done", status: "completed", data: { noteId } });

    const row = await db.cpcv.findUniqueOrThrow({ where: { noteId } });
    const mintArgs = chain.mintNote.mock.calls[0][0] as { proof: SorobanProof; commitment: Uint8Array; nullifier: Uint8Array; totalCommissionCents: bigint; escrituraDay: number };
    expect(mintArgs).toMatchObject({ totalCommissionCents: 1_500_000n, escrituraDay: PROTOCOL_DAY + 90 });
    expect(Buffer.from(mintArgs.commitment).toString("hex")).toBe(row.commitment);
    expect(Buffer.from(mintArgs.nullifier).toString("hex")).toBe(row.nullifier);

    // What cpcv_note would store (amounts in stroops), re-verified like the registry does.
    const onChain = {
      agent: agent.smartAccount!,
      totalCommission: row.totalCommissionCents * 100_000n,
      agentCommission: row.agentCommissionCents * 100_000n,
      escrituraDay: row.escrituraDay,
      commitment: row.commitment,
      nullifier: row.nullifier,
      proof: proofToHex(mintArgs.proof),
    };
    const check = await verifyNoteProof(onChain, await attesterParams(TEST_KEYS), loadVerificationKey());
    expect(check.valid).toBe(true);
    // Cpcv.proof holds the same proof (un-negated) and public signals.
    expect(row.proof).toEqual({ proof: check.snarkjsProof, publicSignals: check.publicSignals });
    // The salt that opens the commitment is in the encrypted record.
    expect(decryptCpcvPii(row.piiEncrypted).salt).toMatch(/^[0-9a-f]{64}$/);
  });
});
