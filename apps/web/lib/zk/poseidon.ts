// Ambient types for snarkjs/circomlibjs, also needed when scripts/ (whose tsconfig
// only includes scripts/**) compiles this module.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./vendor.d.ts" />
// Poseidon (circomlibjs, matching circomlib's Poseidon template) and the
// property_hash encoding (spec §8.4). Server-side (Node route handlers and
// tsx scripts); no `server-only` so scripts can import it.

import { buildEddsa, type Eddsa } from "circomlibjs";

import { assertField, bytesToBigInt } from "./field";

let eddsaPromise: Promise<Eddsa> | undefined;

/** circomlibjs EdDSA (BabyJubJub) + Poseidon, built once per process. */
export function getEddsa(): Promise<Eddsa> {
  eddsaPromise ??= buildEddsa().catch((err) => {
    eddsaPromise = undefined;
    throw err;
  });
  return eddsaPromise;
}

/** Poseidon over BN254 with 1–16 inputs, identical to circomlib's `Poseidon(n)`. */
export async function poseidon(inputs: bigint[]): Promise<bigint> {
  if (inputs.length < 1 || inputs.length > 16) throw new Error("Poseidon takes 1 to 16 inputs");
  const eddsa = await getEddsa();
  return eddsa.F.toObject(eddsa.poseidon(inputs.map((x, i) => assertField(x, `poseidon input ${i}`))));
}

export const PROPERTY_CHUNK_BYTES = 31;
export const PROPERTY_MAX_CHUNKS = 8;
/** 8 chunks × 31 bytes. */
export const PROPERTY_MAX_BYTES = PROPERTY_CHUNK_BYTES * PROPERTY_MAX_CHUNKS;

/** Unicode NFC, lowercase, trim, collapse whitespace runs to one space (spec §8.4). */
export function normalizePropertyAddress(address: string): string {
  return address.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * property_hash (spec §8.4): the normalized address as UTF-8, split into
 * 31-byte chunks (max 8, the last one zero-padded on the right, missing ones
 * zero), each read as a big-endian integer; then
 * `Poseidon(len_bytes, chunk_0, …, chunk_7)` in one 9-input call (circomlib's
 * Poseidon takes up to 16 inputs, so arity does not require the two-call split).
 */
export async function propertyHash(address: string): Promise<bigint> {
  const bytes = new TextEncoder().encode(normalizePropertyAddress(address));
  if (bytes.length === 0) throw new Error("property address is empty");
  if (bytes.length > PROPERTY_MAX_BYTES) {
    throw new Error(`property address is too long (${bytes.length} bytes, max ${PROPERTY_MAX_BYTES})`);
  }
  const chunks: bigint[] = [];
  for (let i = 0; i < PROPERTY_MAX_CHUNKS; i++) {
    const chunk = new Uint8Array(PROPERTY_CHUNK_BYTES);
    chunk.set(bytes.subarray(i * PROPERTY_CHUNK_BYTES, (i + 1) * PROPERTY_CHUNK_BYTES));
    chunks.push(bytesToBigInt(chunk));
  }
  return poseidon([BigInt(bytes.length), ...chunks]);
}
