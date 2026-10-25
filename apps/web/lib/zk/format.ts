// snarkjs ⇄ Soroban encodings for Groth16 proofs and verification keys
// (spec §8.5). Browser-safe: the registry page un-negates on-chain proofs here.
//
// Soroban's BN254 host functions (CAP-0074, soroban-sdk 28 `crypto::bn254`)
// use the Ethereum (EIP-196/197) encoding:
//   G1 (64 B)  = be32(x) ‖ be32(y)
//   G2 (128 B) = be32(x.c1) ‖ be32(x.c0) ‖ be32(y.c1) ‖ be32(y.c0)
// i.e. each Fp2 element is imaginary part first. snarkjs JSON stores Fp2 as
// [c0, c1] (real part first), so the two halves of each G2 coordinate swap.
// The point at infinity is all zero bytes. (Verified against the decoder in
// soroban-env-host 28 `crypto/bn254.rs`, which reverses the 64-byte Fp2 buffer
// into arkworks' little-endian c0 ‖ c1, and end-to-end by the Rust test that
// verifies a real snarkjs proof: contracts/shared/src/groth16.rs.)

import type { SnarkjsProof } from "@/lib/types/api";

import { FIELD_P, bigIntToBytes, bytesToBigInt, fromHex, toHex } from "./field";

/** snarkjs `verification_key.json` (groth16, bn128). */
export interface SnarkjsVerificationKey {
  protocol: "groth16";
  curve: "bn128";
  nPublic: number;
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  vk_alphabeta_12?: unknown;
  IC: string[][];
}

/** Proof bytes as passed to `cpcv_note.mint` (`a` is NEGATED, spec §7.2). */
export interface SorobanProof {
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
}

export interface SorobanProofHex {
  a: string;
  b: string;
  c: string;
}

/** The `VerificationKey` contract type. */
export interface SorobanVerificationKey {
  alpha: Uint8Array;
  beta: Uint8Array;
  gamma: Uint8Array;
  delta: Uint8Array;
  ic: Uint8Array[];
}

/** `apps/web/zk/verification_key.soroban.json`: what the deploy script passes to the cpcv_note constructor. */
export interface SorobanVerificationKeyHex {
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  ic: string[];
}

const G1_LEN = 64;
const G2_LEN = 128;

function coordinate(value: string, what: string): Uint8Array {
  const v = BigInt(value);
  if (v < 0n || v >= FIELD_P) throw new Error(`${what} is not a BN254 base-field element`);
  return bigIntToBytes(v, 32);
}

const isZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);
const asBytes = (v: Uint8Array | string) => (typeof v === "string" ? fromHex(v) : v);

/** snarkjs affine G1 `[x, y, "1"]` (or infinity `[*, *, "0"]`) → 64 bytes. */
export function g1ToBytes(point: string[]): Uint8Array {
  if (point.length !== 3) throw new Error("G1 point must have 3 coordinates");
  const out = new Uint8Array(G1_LEN);
  if (BigInt(point[2]) === 0n) return out;
  if (BigInt(point[2]) !== 1n) throw new Error("G1 point is not affine (z ≠ 1)");
  out.set(coordinate(point[0], "G1.x"), 0);
  out.set(coordinate(point[1], "G1.y"), 32);
  return out;
}

/** 64 bytes → snarkjs affine G1. */
export function g1FromBytes(bytes: Uint8Array): string[] {
  if (bytes.length !== G1_LEN) throw new Error(`G1 must be ${G1_LEN} bytes`);
  if (isZero(bytes)) return ["0", "1", "0"];
  return [bytesToBigInt(bytes.subarray(0, 32)).toString(), bytesToBigInt(bytes.subarray(32)).toString(), "1"];
}

/** snarkjs affine G2 `[[x.c0, x.c1], [y.c0, y.c1], ["1", "0"]]` → 128 bytes (imaginary part first). */
export function g2ToBytes(point: string[][]): Uint8Array {
  if (point.length !== 3 || point.some((c) => c.length !== 2)) throw new Error("G2 point must be 3 Fp2 coordinates");
  const out = new Uint8Array(G2_LEN);
  const [z0, z1] = point[2].map(BigInt);
  if (z0 === 0n && z1 === 0n) return out;
  if (z0 !== 1n || z1 !== 0n) throw new Error("G2 point is not affine (z ≠ 1)");
  out.set(coordinate(point[0][1], "G2.x.c1"), 0);
  out.set(coordinate(point[0][0], "G2.x.c0"), 32);
  out.set(coordinate(point[1][1], "G2.y.c1"), 64);
  out.set(coordinate(point[1][0], "G2.y.c0"), 96);
  return out;
}

/** 128 bytes → snarkjs affine G2. */
export function g2FromBytes(bytes: Uint8Array): string[][] {
  if (bytes.length !== G2_LEN) throw new Error(`G2 must be ${G2_LEN} bytes`);
  if (isZero(bytes)) return [["0", "0"], ["1", "0"], ["0", "0"]];
  const fp = (offset: number) => bytesToBigInt(bytes.subarray(offset, offset + 32)).toString();
  return [
    [fp(32), fp(0)],
    [fp(96), fp(64)],
    ["1", "0"],
  ];
}

/** −P for a G1 point: (x, y) → (x, p − y). Infinity stays infinity. Self-inverse. */
export function negateG1(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== G1_LEN) throw new Error(`G1 must be ${G1_LEN} bytes`);
  if (isZero(bytes)) return new Uint8Array(G1_LEN);
  const y = bytesToBigInt(bytes.subarray(32));
  if (y >= FIELD_P) throw new Error("G1.y is not a BN254 base-field element");
  const out = new Uint8Array(bytes);
  out.set(bigIntToBytes(y === 0n ? 0n : FIELD_P - y, 32), 32);
  return out;
}

/** snarkjs proof → Soroban bytes, negating A (spec §8.5). */
export function proofToSoroban(proof: SnarkjsProof): SorobanProof {
  return {
    a: negateG1(g1ToBytes(proof.pi_a)),
    b: g2ToBytes(proof.pi_b),
    c: g1ToBytes(proof.pi_c),
  };
}

/** Soroban proof bytes or hex (A negated, as stored on-chain) → snarkjs proof with A un-negated. */
export function sorobanToProof(proof: SorobanProof | SorobanProofHex): SnarkjsProof {
  return {
    pi_a: g1FromBytes(negateG1(asBytes(proof.a))),
    pi_b: g2FromBytes(asBytes(proof.b)),
    pi_c: g1FromBytes(asBytes(proof.c)),
    protocol: "groth16",
    curve: "bn128",
  };
}

export const proofToHex = (p: SorobanProof): SorobanProofHex => ({ a: toHex(p.a), b: toHex(p.b), c: toHex(p.c) });

export const proofFromHex = (p: SorobanProofHex): SorobanProof => ({
  a: fromHex(p.a),
  b: fromHex(p.b),
  c: fromHex(p.c),
});

/** snarkjs verification key → the `VerificationKey` contract struct (ic has nPublic + 1 points). */
export function vkToSoroban(vk: SnarkjsVerificationKey): SorobanVerificationKey {
  if (vk.protocol !== "groth16" || vk.curve !== "bn128") throw new Error("expected a groth16/bn128 verification key");
  if (vk.IC.length !== vk.nPublic + 1) throw new Error("IC length must be nPublic + 1");
  return {
    alpha: g1ToBytes(vk.vk_alpha_1),
    beta: g2ToBytes(vk.vk_beta_2),
    gamma: g2ToBytes(vk.vk_gamma_2),
    delta: g2ToBytes(vk.vk_delta_2),
    ic: vk.IC.map(g1ToBytes),
  };
}

export function vkToSorobanHex(vk: SnarkjsVerificationKey): SorobanVerificationKeyHex {
  const s = vkToSoroban(vk);
  return { alpha: toHex(s.alpha), beta: toHex(s.beta), gamma: toHex(s.gamma), delta: toHex(s.delta), ic: s.ic.map(toHex) };
}

export function vkFromSorobanHex(vk: SorobanVerificationKeyHex): SorobanVerificationKey {
  return {
    alpha: fromHex(vk.alpha),
    beta: fromHex(vk.beta),
    gamma: fromHex(vk.gamma),
    delta: fromHex(vk.delta),
    ic: vk.ic.map(fromHex),
  };
}

/** Normalizes the proof object returned by `snarkjs.groth16.prove` to the `SnarkjsProof` API type. */
export function normalizeSnarkjsProof(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): SnarkjsProof {
  return {
    pi_a: proof.pi_a.map(String),
    pi_b: proof.pi_b.map((c) => c.map(String)),
    pi_c: proof.pi_c.map(String),
    protocol: "groth16",
    curve: "bn128",
  };
}
