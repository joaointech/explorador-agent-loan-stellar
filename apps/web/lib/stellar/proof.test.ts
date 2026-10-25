import { describe, expect, it } from "vitest";

import type { SnarkjsProof } from "@/lib/types/api";
import { agentFieldHex } from "@/lib/zk/agent-field";

import { decodeNote } from "./decode";
import { AGENT, noteScVal } from "./fixtures";
import { BN254_P, publicSignalsFromNote, snarkjsToSorobanProof, sorobanProofToSnarkjs } from "./proof";

const w = (n: number) => n.toString(16).padStart(64, "0");

// A syntactically valid snarkjs proof (coordinates are arbitrary field elements).
const PROOF: SnarkjsProof = {
  pi_a: ["11", "22", "1"],
  pi_b: [
    ["31", "32"],
    ["41", "42"],
    ["1", "0"],
  ],
  pi_c: ["51", "52", "1"],
  protocol: "groth16",
  curve: "bn128",
};

describe("proof formatting", () => {
  it("encodes G2 as X.c1 ‖ X.c0 ‖ Y.c1 ‖ Y.c0 and negates A", () => {
    const hex = snarkjsToSorobanProof(PROOF);
    expect(hex.b).toBe(w(32) + w(31) + w(42) + w(41));
    expect(hex.a.slice(0, 64)).toBe(w(11));
    expect(BigInt(`0x${hex.a.slice(64)}`)).toBe(BN254_P - 22n);
    expect(hex.c).toBe(w(51) + w(52));
  });

  it("round-trips (negate / un-negate A)", () => {
    expect(sorobanProofToSnarkjs(snarkjsToSorobanProof(PROOF))).toEqual(PROOF);
  });

  it("keeps the point at y = 0 fixed under negation", () => {
    const zeroY = { ...PROOF, pi_a: ["5", "0", "1"] };
    expect(sorobanProofToSnarkjs(snarkjsToSorobanProof(zeroY)).pi_a).toEqual(["5", "0", "1"]);
  });
});

describe("publicSignalsFromNote", () => {
  it("rebuilds the 9 signals in circuit order (§8.2) with amounts in cents", () => {
    const note = decodeNote(noteScVal());
    const signals = publicSignalsFromNote(note, { attesterAx: "7", attesterAy: "8", nullifierSecretCommitment: "9" });
    expect(signals).toEqual([
      BigInt(`0x${agentFieldHex(AGENT)}`).toString(),
      "1500000",
      "750000",
      "20500",
      BigInt(`0x${"11".repeat(32)}`).toString(),
      BigInt(`0x${"22".repeat(32)}`).toString(),
      "7",
      "8",
      "9",
    ]);
  });
});
