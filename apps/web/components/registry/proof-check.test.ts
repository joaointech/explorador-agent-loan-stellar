// "Verify proof in your browser" logic, run in Node against the committed
// fixture proofs (the bytes the Soroban tests verify), the key the app serves
// at /zk/verification_key.json and the cpcv_note views as the contract encodes
// them.

import { groth16 } from "snarkjs";
import { afterAll, describe, expect, it } from "vitest";

import { toHex } from "@/lib/zk/field";
import { proofFromHex, proofToHex, sorobanToProof } from "@/lib/zk/format";
import { proveCpcvWithKeys, releaseZkResources } from "@/lib/zk/prove";
import type { RegistryDetailResponse } from "@/lib/types/api";

import { NOTE_CONTRACT, fakeView, fixtureSnapshot } from "./__tests__/chain-fixtures";
import { detailResponse, fixtureNotes, loadServedVerificationKey } from "./__tests__/fixtures";
import { ChainRejectedError, ChainUnavailableError } from "./chain-errors";
import { readChainSnapshot } from "./chain-note";
import { checkNoteProof, sameProof, type ProofCheckDeps, type ProofCheckStep } from "./proof-check";

afterAll(releaseZkResources);

const base: ProofCheckDeps = {
  loadVerifier: async () => groth16,
  loadVerificationKey: async () => loadServedVerificationKey(),
};
/** Reads the chain like the browser does, from a fake RPC answering like cpcv_note. */
const withChain = (index = 0, id = 1): ProofCheckDeps => ({ ...base, readChain: () => readChainSnapshot(fakeView(index, id), id, NOTE_CONTRACT) });

function track() {
  const events: string[] = [];
  return { events, onStep: (step: ProofCheckStep, status: string) => events.push(`${step}:${status}`) };
}

describe("checkNoteProof against Stellar", () => {
  it("parses the three fixture notes", () => {
    const notes = fixtureNotes();
    expect(notes).toHaveLength(3);
    expect(notes[0].totalCommissionCents).toBe(1_500_000n);
    for (const n of notes) {
      expect(n.proof.a).toHaveLength(128);
      expect(n.proof.b).toHaveLength(256);
      expect(n.proof.c).toHaveLength(128);
      expect(n.publicInputs).toHaveLength(9);
    }
  });

  it.each([0, 1, 2])("verifies fixture note %i on the on-chain data and the served key", { timeout: 30_000 }, async (index) => {
    const { events, onStep } = track();
    const result = await checkNoteProof(detailResponse(index, index + 1), withChain(index, index + 1), onStep);
    expect(result).toMatchObject({ valid: true, source: "chain", contractId: NOTE_CONTRACT });
    if (result.valid) expect(result.verifyMs).toBeGreaterThan(0);
    expect(events).toEqual([
      "verifier:active",
      "verifier:done",
      "key:active",
      "key:done",
      "chain:active",
      "chain:done",
      "signals:active",
      "signals:done",
      "proof:active",
      "proof:done",
      "pairing:active",
      "pairing:done",
    ]);
  });

  it("verifies from Stellar alone when the registry has no signals or snarkjs proof", { timeout: 30_000 }, async () => {
    const result = await checkNoteProof({ ...detailResponse(0), publicSignals: [], snarkjsProof: null }, withChain());
    expect(result).toMatchObject({ valid: true, source: "chain" });
  });

  it("fails when the registry's copy differs from the note on Stellar", async () => {
    const detail = detailResponse(0);
    detail.note.totalCommission = (BigInt(detail.note.totalCommission) + 100_000n).toString();
    detail.note.escrituraDay += 1;
    const result = await checkNoteProof(detail, withChain());
    expect(result).toMatchObject({ valid: false, failedStep: "chain" });
    if (!result.valid) expect(result.reason).toMatch(/total commission, escritura date/);
  });

  it("fails when the published verification key isn't the contract's", async () => {
    const snapshot = fixtureSnapshot();
    snapshot.vk = { ...snapshot.vk, ic: [...snapshot.vk.ic].reverse() };
    const result = await checkNoteProof(detailResponse(0), { ...base, readChain: async () => snapshot });
    expect(result).toMatchObject({ valid: false, failedStep: "chain" });
    if (!result.valid) expect(result.reason).toMatch(/verification key/);
  });

  it("fails when the registry's attester signals aren't the contract's attester key", async () => {
    const detail = detailResponse(0);
    detail.publicSignals = [...detail.publicSignals];
    detail.publicSignals[6] = (BigInt(detail.publicSignals[6]) + 1n).toString();
    const result = await checkNoteProof(detail, withChain());
    expect(result).toMatchObject({ valid: false, failedStep: "signals" });
    if (!result.valid) expect(result.reason).toMatch(/attester key \(x\)/);
  });

  it("rejects a proof made under another attester key, even with consistent bytes and signals", { timeout: 60_000 }, async () => {
    // Anyone can prove with the committed proving key under their own key: pin the attester key to the contract's.
    const fixture = fixtureNotes()[0];
    const forged = await proveCpcvWithKeys(
      fixture.agent,
      {
        buyerNif: "123456789",
        sellerNif: "987654321",
        salePriceCents: 30_000_000n,
        commissionRateBps: 500,
        propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
        cpcvDay: 20751,
        escrituraDay: fixture.escrituraDay,
      },
      { attesterPrivKey: "b2".repeat(32), nullifierSecret: "24832862275159723283241326441814195924414518770204777827089555393853918734" },
    );
    const forgedHex = proofToHex(forged.sorobanProof);
    const detail: RegistryDetailResponse = {
      ...detailResponse(0),
      publicSignals: forged.publicSignals,
      snarkjsProof: forged.snarkjsProof,
    };
    detail.note = { ...detail.note, commitment: toHex(forged.commitment), nullifier: toHex(forged.nullifier), proof: forgedHex };

    // Without Stellar the math checks out, and the result says it rests on the registry only.
    const registryOnly = await checkNoteProof(detail, base);
    expect(registryOnly).toMatchObject({ valid: true, source: "registry" });

    // Even if the chain held these exact bytes, its attester key (the TEST key) exposes the forgery.
    const snapshot = fixtureSnapshot();
    snapshot.note = { ...snapshot.note, commitment: detail.note.commitment, nullifier: detail.note.nullifier, proof: forgedHex };
    const pinned = await checkNoteProof(detail, { ...base, readChain: async () => snapshot });
    expect(pinned).toMatchObject({ valid: false, failedStep: "signals" });
    const pinnedNoSignals = await checkNoteProof({ ...detail, publicSignals: [], snarkjsProof: null }, { ...base, readChain: async () => snapshot });
    expect(pinnedNoSignals).toMatchObject({ valid: false, failedStep: "pairing" });
  });

  it("fails when Stellar answers with an error, falls back when it can't be reached", { timeout: 30_000 }, async () => {
    const rejected = await checkNoteProof(detailResponse(0), {
      ...base,
      readChain: async () => {
        throw new ChainRejectedError("cpcv_note.get failed on Stellar: HostError: Error(Contract, #18)");
      },
    });
    expect(rejected).toMatchObject({ valid: false, failedStep: "chain" });

    const broken = await checkNoteProof(detailResponse(0), {
      ...base,
      readChain: async () => {
        throw new TypeError("boom");
      },
    });
    expect(broken).toMatchObject({ valid: false, failedStep: "chain" });

    const { events, onStep } = track();
    const offline = await checkNoteProof(
      detailResponse(0),
      {
        ...base,
        readChain: async () => {
          throw new ChainUnavailableError("Soroban RPC didn't answer: Failed to fetch");
        },
      },
      onStep,
    );
    expect(offline).toMatchObject({ valid: true, source: "registry", chainSkipped: "Soroban RPC didn't answer: Failed to fetch" });
    expect(events).toContain("chain:skipped");
  });
});

describe("checkNoteProof on the registry's copy (Stellar unreachable)", () => {
  it("verifies, saying the result rests on the registry", { timeout: 30_000 }, async () => {
    const result = await checkNoteProof(detailResponse(1, 2), base);
    expect(result).toMatchObject({ valid: true, source: "registry" });
  });

  it("rejects a note whose displayed commission differs from the proved one", async () => {
    const detail = detailResponse(0);
    detail.note.totalCommission = (BigInt(detail.note.totalCommission) + 100_000n).toString();
    const { events, onStep } = track();
    const result = await checkNoteProof(detail, base, onStep);
    expect(result).toMatchObject({ valid: false, failedStep: "signals" });
    if (!result.valid) expect(result.reason).toMatch(/total commission/);
    expect(events.at(-1)).toBe("signals:error");
  });

  it("rejects a note shown with another agent's address", async () => {
    const detail = detailResponse(0);
    detail.note.agent = fixtureNotes()[2].agent;
    expect(await checkNoteProof(detail, base)).toMatchObject({ valid: false, failedStep: "signals" });
  });

  it("fails the pairing check when signals and note agree but the proof doesn't prove them", { timeout: 30_000 }, async () => {
    const detail = detailResponse(1);
    detail.note.proof = fixtureNotes()[0].proof;
    detail.snarkjsProof = sorobanToProof(fixtureNotes()[0].proof);
    expect(await checkNoteProof(detail, base)).toMatchObject({ valid: false, failedStep: "pairing" });
  });

  it("rejects a snarkjs proof that differs from the stored bytes, including a flipped z coordinate", async () => {
    const other = detailResponse(0);
    other.snarkjsProof = sorobanToProof(fixtureNotes()[1].proof);
    expect(await checkNoteProof(other, base)).toMatchObject({ valid: false, failedStep: "proof" });

    const infinity = detailResponse(0);
    infinity.snarkjsProof = { ...infinity.snarkjsProof!, pi_a: [infinity.snarkjsProof!.pi_a[0], infinity.snarkjsProof!.pi_a[1], "0"] };
    expect(await checkNoteProof(infinity, base)).toMatchObject({ valid: false, failedStep: "proof" });
  });

  it("explains missing signals and unreachable keys instead of throwing", async () => {
    expect(await checkNoteProof({ ...detailResponse(0), publicSignals: [] }, base)).toMatchObject({ valid: false, failedStep: "signals" });

    const noKey = await checkNoteProof(detailResponse(0), {
      ...base,
      loadVerificationKey: async () => {
        throw new Error("HTTP 404");
      },
    });
    expect(noKey).toMatchObject({ valid: false, failedStep: "key" });
    if (!noKey.valid) expect(noKey.reason).toContain("HTTP 404");

    const wrongKey = await checkNoteProof(detailResponse(0), { ...base, loadVerificationKey: async () => ({ ...loadServedVerificationKey(), nPublic: 3 }) });
    expect(wrongKey).toMatchObject({ valid: false, failedStep: "key" });
  });
});

describe("sameProof", () => {
  it("compares every coordinate, reading a missing z as 1", () => {
    const p = sorobanToProof(proofFromHex(fixtureNotes()[0].proof));
    expect(sameProof(p, { ...p, pi_a: p.pi_a.slice(0, 2) })).toBe(true);
    expect(sameProof(p, { ...p, pi_a: [p.pi_a[0], p.pi_a[1], "0"] })).toBe(false);
    expect(sameProof(p, sorobanToProof(fixtureNotes()[1].proof))).toBe(false);
    expect(sameProof(p, { ...p, pi_b: [p.pi_b[0], p.pi_b[1]] })).toBe(true);
    expect(sameProof(p, { ...p, pi_b: [p.pi_b[0]] })).toBe(false);
  });
});
