// Off-chain ZK keys (spec §3, §11.1): the BabyJubJub attester key that signs
// CPCV attestations and explorador's nullifier secret. Used by
// `pnpm keys:generate`, the deploy script (constructor arguments) and the prover.

import { assertField, fieldToBytes, fromHex, randomBytes, randomField31, toHex } from "./field";
import { getEddsa, poseidon } from "./poseidon";

/** A new attester private key: 32 random bytes, hex (`ATTESTER_EDDSA_PRIVKEY`). */
export function generateAttesterKey(): string {
  return toHex(randomBytes(32));
}

/** Parses `ATTESTER_EDDSA_PRIVKEY` (64 hex chars, optional 0x). */
export function parseAttesterKey(privateKeyHex: string): Uint8Array {
  const key = fromHex(privateKeyHex.trim());
  if (key.length !== 32) throw new Error("ATTESTER_EDDSA_PRIVKEY must be 32 bytes of hex");
  return key;
}

export interface AttesterPublicKey {
  /** BabyJubJub public key coordinates as `BytesN<32>` (big-endian): cpcv_note constructor args. */
  ax: Uint8Array;
  ay: Uint8Array;
  axHex: string;
  ayHex: string;
}

/** EdDSA-Poseidon public key (Ax, Ay) of an attester private key. */
export async function attesterPublicKey(privateKeyHex: string): Promise<AttesterPublicKey> {
  const eddsa = await getEddsa();
  const [x, y] = eddsa.prv2pub(parseAttesterKey(privateKeyHex)).map((c) => eddsa.F.toObject(c));
  const ax = fieldToBytes(x);
  const ay = fieldToBytes(y);
  return { ax, ay, axHex: toHex(ax), ayHex: toHex(ay) };
}

/** A new `NULLIFIER_SECRET`: 31 random bytes as a decimal field element. */
export function generateNullifierSecret(): string {
  return randomField31().toString();
}

/** Parses `NULLIFIER_SECRET` (decimal, or 0x-prefixed hex) and checks it is a field element. */
export function parseNullifierSecret(secret: string | bigint): bigint {
  const value = typeof secret === "bigint" ? secret : BigInt(secret.trim());
  return assertField(value, "NULLIFIER_SECRET");
}

/** Poseidon(nullifier_secret) as `BytesN<32>`: the cpcv_note constructor's `nullifier_secret_commitment`. */
export async function nullifierSecretCommitment(secret: string | bigint): Promise<Uint8Array> {
  return fieldToBytes(await poseidon([parseNullifierSecret(secret)]));
}

/**
 * The cpcv_note constructor's `attester_ax`, `attester_ay` and
 * `nullifier_secret_commitment`, derived from the two secrets (deploy script,
 * registry API). Same shape as `AttesterParams` in ./public-signals.
 */
export async function attesterParams(keys: { attesterPrivKey: string; nullifierSecret: string | bigint }) {
  const { ax, ay } = await attesterPublicKey(keys.attesterPrivKey);
  return {
    attesterAx: ax,
    attesterAy: ay,
    nullifierSecretCommitment: await nullifierSecretCommitment(keys.nullifierSecret),
  };
}
