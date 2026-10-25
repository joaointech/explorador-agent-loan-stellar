// snarkjs ⇄ Soroban encodings (§8.5).
//
// G1: 64 bytes be(x) ‖ be(y).
// G2: 128 bytes be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0)   (soroban_sdk Bn254G2Affine).
// snarkjs writes Fp2 elements as [c0, c1], so each pair is swapped.
// The proof's A is negated (y → p − y) before it goes on-chain.

import { FP, toHex32 } from "./field";

export interface SnarkjsProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

export interface SnarkjsVk {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
}

/** Hex-encoded Soroban proof (`Groth16Proof`), with `a` negated. */
export interface SorobanProof {
  a: string; // 64 bytes hex (−A)
  b: string; // 128 bytes hex
  c: string; // 64 bytes hex
}

export interface SorobanVk {
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  ic: string[];
}

export function g1Hex(p: string[]): string {
  return toHex32(BigInt(p[0])) + toHex32(BigInt(p[1]));
}

export function g2Hex(p: string[][]): string {
  const [x, y] = p;
  return toHex32(BigInt(x[1])) + toHex32(BigInt(x[0])) + toHex32(BigInt(y[1])) + toHex32(BigInt(y[0]));
}

export function negateY(y: bigint): bigint {
  return y === 0n ? 0n : FP - (y % FP);
}

export function formatProof(proof: SnarkjsProof): SorobanProof {
  const ax = BigInt(proof.pi_a[0]);
  const ay = BigInt(proof.pi_a[1]);
  return {
    a: toHex32(ax) + toHex32(negateY(ay)),
    b: g2Hex(proof.pi_b),
    c: g1Hex(proof.pi_c),
  };
}

/** Inverse of `formatProof`: rebuilds the snarkjs proof JSON from on-chain bytes. */
export function unformatProof(p: SorobanProof): SnarkjsProof {
  const h = (hex: string, i: number) => BigInt("0x" + hex.slice(i * 64, (i + 1) * 64)).toString();
  const ax = h(p.a, 0);
  const ay = negateY(BigInt("0x" + p.a.slice(64, 128))).toString();
  return {
    pi_a: [ax, ay, "1"],
    // on-chain order is x.c1, x.c0, y.c1, y.c0
    pi_b: [
      [h(p.b, 1), h(p.b, 0)],
      [h(p.b, 3), h(p.b, 2)],
      ["1", "0"],
    ],
    pi_c: [h(p.c, 0), h(p.c, 1), "1"],
    protocol: "groth16",
    curve: "bn128",
  };
}

export function formatVk(vk: SnarkjsVk): SorobanVk {
  return {
    alpha: g1Hex(vk.vk_alpha_1),
    beta: g2Hex(vk.vk_beta_2),
    gamma: g2Hex(vk.vk_gamma_2),
    delta: g2Hex(vk.vk_delta_2),
    ic: vk.IC.map(g1Hex),
  };
}
