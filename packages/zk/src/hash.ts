/// <reference path="./types.d.ts" />
// Poseidon + EdDSA-Poseidon (BabyJubJub) helpers backed by circomlibjs, plus
// the off-chain encodings that must match the circuit and contracts (§8.4).

import { buildEddsa, buildPoseidon } from "circomlibjs";
import { bytesToBigInt, FR, hexToBytes, toHex32 } from "./field";

let poseidonP: Promise<any> | null = null;
let eddsaP: Promise<any> | null = null;

function getPoseidon() {
  poseidonP ??= buildPoseidon();
  return poseidonP;
}

function getEddsa() {
  eddsaP ??= buildEddsa();
  return eddsaP;
}

export async function poseidon(inputs: bigint[]): Promise<bigint> {
  const p = await getPoseidon();
  for (const x of inputs) if (x < 0n || x >= FR) throw new Error("poseidon input out of field");
  return p.F.toObject(p(inputs)) as bigint;
}

/** Normalizes a property address: lowercase, trim, collapse internal whitespace. */
export function normalizeAddress(address: string): string {
  return address.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * property_hash = Poseidon(len_bytes, chunk_0 … chunk_7) where chunks are the
 * UTF-8 bytes of the normalized address split into 31-byte big-endian field
 * elements (zero-padded to 8 chunks). circomlibjs supports 9 inputs in one call.
 */
export async function propertyHash(address: string): Promise<bigint> {
  const bytes = new TextEncoder().encode(normalizeAddress(address));
  if (bytes.length > 31 * 8) throw new Error("property address longer than 248 bytes");
  const chunks: bigint[] = [];
  for (let i = 0; i < 8; i++) chunks.push(bytesToBigInt(bytes.slice(i * 31, (i + 1) * 31)));
  return poseidon([BigInt(bytes.length), ...chunks]);
}

export interface AttesterPublicKey {
  ax: bigint;
  ay: bigint;
}

function attesterKeyBytes(privHex: string): Uint8Array {
  const prv = hexToBytes(privHex);
  if (prv.length !== 32) throw new Error("ATTESTER_EDDSA_PRIVKEY must be 32 bytes hex");
  return prv;
}

export async function attesterPublicKey(privHex: string): Promise<AttesterPublicKey> {
  const eddsa = await getEddsa();
  const pub = eddsa.prv2pub(attesterKeyBytes(privHex));
  return { ax: eddsa.F.toObject(pub[0]) as bigint, ay: eddsa.F.toObject(pub[1]) as bigint };
}

export interface EddsaSignature {
  r8x: bigint;
  r8y: bigint;
  s: bigint;
}

export async function signPoseidon(privHex: string, msg: bigint): Promise<EddsaSignature> {
  const eddsa = await getEddsa();
  const sig = eddsa.signPoseidon(attesterKeyBytes(privHex), eddsa.F.e(msg));
  return {
    r8x: eddsa.F.toObject(sig.R8[0]) as bigint,
    r8y: eddsa.F.toObject(sig.R8[1]) as bigint,
    s: BigInt(sig.S),
  };
}

export async function verifyPoseidonSignature(pub: AttesterPublicKey, msg: bigint, sig: EddsaSignature): Promise<boolean> {
  const eddsa = await getEddsa();
  const F = eddsa.F;
  return eddsa.verifyPoseidon(F.e(msg), { R8: [F.e(sig.r8x), F.e(sig.r8y)], S: sig.s }, [F.e(pub.ax), F.e(pub.ay)]);
}

export function fieldHex(v: bigint): string {
  return toHex32(v);
}
