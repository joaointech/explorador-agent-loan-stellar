// "Verify proof in your browser" logic, run in Node against the committed
// fixture proofs (the bytes the Soroban tests verify) and the key the app
// serves at /zk/verification_key.json.

import { groth16 } from "snarkjs";
import { afterAll, describe, expect, it } from "vitest";

import { releaseZkResources } from "@/lib/zk/prove";
import { proofFromHex, sorobanToProof } from "@/lib/zk/format";

import { detailResponse, fixtureNotes, loadServedVerificationKey } from "./__tests__/fixtures";
import { checkNoteProof, sameProof, type ProofCheckDeps, type ProofCheckStep } from "./proof-check";

afterAll(releaseZkResources);

const deps: ProofCheckDeps = {
  loadVerifier: async () => groth16,
  loadVerificationKey: async () => loadServedVerificationKey(),
};

function track() {
  const events: string[] = [];
  return { events, onStep: (step: ProofCheckStep, status: string) => events.push(`${step}:${status}`) };
}

describe("checkNoteProof", () => {
  it("parses the three fixture notes", () => {
    const notes = fixtureNotes();
    expect(notes).toHaveLength(3);
    expect(notes[0].totalCommissionCents).toBe(1_500_000n);
    expect(notes[0].agentCommissionCents).toBe(750_000n);
    for (const n of notes) {
      expect(n.proof.a).toHaveLength(128);
      expect(n.proof.b).toHaveLength(256);
      expect(n.proof.c).toHaveLength(128);
      expect(n.publicInputs).toHaveLength(9);
    }
  });

  it.each([0, 1, 2])("verifies fixture note %i with the served verification key", { timeout: 30_000 }, async (index) => {
    const { events, onStep } = track();
    const result = await checkNoteProof(detailResponse(index), deps, onStep);
    expect(result).toMatchObject({ valid: true });
    if (result.valid) expect(result.verifyMs).toBeGreaterThan(0);
    expect(events).toEqual([
      "verifier:active",
      "verifier:done",
      "key:active",
      "key:done",
      "signals:active",
      "signals:done",
      "proof:active",
      "proof:done",
      "pairing:active",
      "pairing:done",
    ]);
  });

  it("verifies from the on-chain bytes alone when the API has no snarkjs proof", { timeout: 30_000 }, async () => {
    const result = await checkNoteProof({ ...detailResponse(0), snarkjsProof: null }, deps);
    expect(result.valid).toBe(true);
  });

  it("rejects a note whose displayed commission differs from the proved one", async () => {
    const detail = detailResponse(0);
    detail.note.totalCommission = (BigInt(detail.note.totalCommission) + 100_000n).toString();
    const { events, onStep } = track();
    const result = await checkNoteProof(detail, deps, onStep);
    expect(result).toMatchObject({ valid: false, failedStep: "signals" });
    if (!result.valid) expect(result.reason).toMatch(/total commission/);
    expect(events.at(-1)).toBe("signals:error");
  });

  it("rejects a note shown with another agent's address", async () => {
    const detail = detailResponse(0);
    detail.note.agent = fixtureNotes()[2].agent;
    const result = await checkNoteProof(detail, deps);
    expect(result).toMatchObject({ valid: false, failedStep: "signals" });
  });

  it("fails the pairing check when the API's signals and note agree but the proof doesn't prove them", { timeout: 30_000 }, async () => {
    // Signals and note fields of fixture 1, proof of fixture 0: consistent data, wrong proof.
    const detail = detailResponse(1);
    detail.note.proof = fixtureNotes()[0].proof;
    detail.snarkjsProof = sorobanToProof(fixtureNotes()[0].proof);
    const result = await checkNoteProof(detail, deps);
    expect(result).toMatchObject({ valid: false, failedStep: "pairing" });
  });

  it("rejects an API proof that differs from the on-chain bytes", async () => {
    const detail = detailResponse(0);
    detail.snarkjsProof = sorobanToProof(fixtureNotes()[1].proof);
    const result = await checkNoteProof(detail, deps);
    expect(result).toMatchObject({ valid: false, failedStep: "proof" });
  });

  it("explains missing public signals and unreachable keys instead of throwing", async () => {
    const noSignals = await checkNoteProof({ ...detailResponse(0), publicSignals: [] }, deps);
    expect(noSignals).toMatchObject({ valid: false, failedStep: "signals" });

    const noKey = await checkNoteProof(detailResponse(0), {
      ...deps,
      loadVerificationKey: async () => {
        throw new Error("HTTP 404");
      },
    });
    expect(noKey).toMatchObject({ valid: false, failedStep: "key" });
    if (!noKey.valid) expect(noKey.reason).toContain("HTTP 404");

    const wrongKey = await checkNoteProof(detailResponse(0), { ...deps, loadVerificationKey: async () => ({ ...loadServedVerificationKey(), nPublic: 3 }) });
    expect(wrongKey).toMatchObject({ valid: false, failedStep: "key" });
  });

  it("compares proofs by affine coordinates", () => {
    const p = sorobanToProof(proofFromHex(fixtureNotes()[0].proof));
    expect(sameProof(p, { ...p, pi_a: p.pi_a.slice(0, 2) })).toBe(true);
    expect(sameProof(p, sorobanToProof(fixtureNotes()[1].proof))).toBe(false);
  });
});
