// On-chain Groth16 proof bytes ⇄ snarkjs JSON (spec §8.5), for the registry's
// "Verify proof in your browser" when a note has no stored snarkjs proof.
// Encodings (soroban-sdk 28 `crypto::bn254`, CAP-0074), all big-endian:
//   G1 (64 B)  = X ‖ Y
//   G2 (128 B) = X.c1 ‖ X.c0 ‖ Y.c1 ‖ Y.c0   (c0 real, c1 imaginary)
// snarkjs: pi_b = [[X.c0, X.c1], [Y.c0, Y.c1], ["1","0"]]. On-chain A is −A.

import type { SnarkjsProof } from "@/lib/types/api";
import type { Groth16ProofHex, Note } from "@/lib/types/chain";
import { STROOPS_PER_CENT } from "@/lib/units";
import { agentFieldHex } from "@/lib/zk/agent-field";

import { bytesToHex, hexToBytes } from "./scval";

/** BN254 base-field modulus p. */
export const BN254_P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

const word = (bytes: Uint8Array, index: number): bigint => BigInt(`0x${bytesToHex(bytes.subarray(index * 32, index * 32 + 32)) || "0"}`);
const toWord = (value: bigint): string => value.toString(16).padStart(64, "0");
const negY = (y: bigint): bigint => (y === 0n ? 0n : BN254_P - y);

/** Converts the stored proof (A negated) into an un-negated snarkjs proof. */
export function sorobanProofToSnarkjs(proof: Groth16ProofHex): SnarkjsProof {
  const a = hexToBytes(proof.a);
  const b = hexToBytes(proof.b);
  const c = hexToBytes(proof.c);
  if (a.length !== 64 || b.length !== 128 || c.length !== 64) throw new RangeError("proof must be 64/128/64 bytes");
  return {
    pi_a: [word(a, 0).toString(), negY(word(a, 1)).toString(), "1"],
    pi_b: [
      [word(b, 1).toString(), word(b, 0).toString()],
      [word(b, 3).toString(), word(b, 2).toString()],
      ["1", "0"],
    ],
    pi_c: [word(c, 0).toString(), word(c, 1).toString(), "1"],
    protocol: "groth16",
    curve: "bn128",
  };
}

/** Inverse of sorobanProofToSnarkjs (negates A); used by tests and parity checks. */
export function snarkjsToSorobanProof(proof: SnarkjsProof): Groth16ProofHex {
  const n = (s: string) => BigInt(s);
  return {
    a: toWord(n(proof.pi_a[0])) + toWord(negY(n(proof.pi_a[1]))),
    b: toWord(n(proof.pi_b[0][1])) + toWord(n(proof.pi_b[0][0])) + toWord(n(proof.pi_b[1][1])) + toWord(n(proof.pi_b[1][0])),
    c: toWord(n(proof.pi_c[0])) + toWord(n(proof.pi_c[1])),
  };
}

const hexToDecimal = (hex: string): string => BigInt(`0x${hex.replace(/^0x/, "") || "0"}`).toString();

/**
 * The 9 public signals in circuit order (spec §8.2) rebuilt from on-chain
 * data. The last three (attester key, nullifier-secret commitment) are
 * contract constants without a view function, so they are passed in.
 */
export function publicSignalsFromNote(note: Note, constants: { attesterAx: string; attesterAy: string; nullifierSecretCommitment: string }): string[] {
  return [
    hexToDecimal(agentFieldHex(note.agent)),
    (note.totalCommission / STROOPS_PER_CENT).toString(),
    (note.agentCommission / STROOPS_PER_CENT).toString(),
    String(note.escrituraDay),
    hexToDecimal(note.commitment),
    hexToDecimal(note.nullifier),
    constants.attesterAx,
    constants.attesterAy,
    constants.nullifierSecretCommitment,
  ];
}
