// BN254 field helpers and byte encodings (spec §8.4). Browser-safe: no Node
// built-ins, no Buffer, so the registry page can use them client-side.

/** BN254 scalar field modulus r (circuit signals, public inputs). */
export const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** BN254 base field modulus p (curve point coordinates). */
export const FIELD_P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

export const U32_MAX = 0xffff_ffffn;
export const U64_MAX = 0xffff_ffff_ffff_ffffn;

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Accepts an optional 0x prefix; throws on odd length or non-hex characters. */
export function fromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error(`invalid hex string: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Unsigned big-endian bytes → bigint. */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.length === 0 ? 0n : BigInt("0x" + toHex(bytes));
}

/** bigint → fixed-width unsigned big-endian bytes (32 by default). */
export function bigIntToBytes(value: bigint, length = 32): Uint8Array {
  if (value < 0n) throw new Error("negative value");
  const hex = value.toString(16);
  if (hex.length > length * 2) throw new Error(`value does not fit in ${length} bytes`);
  return fromHex(hex.padStart(length * 2, "0"));
}

/** Throws unless 0 ≤ value < r. */
export function assertField(value: bigint, name = "value"): bigint {
  if (value < 0n || value >= FIELD_R) throw new Error(`${name} is not a BN254 scalar-field element`);
  return value;
}

/** A field element as `BytesN<32>` (big-endian), the on-chain encoding. */
export const fieldToBytes = (value: bigint): Uint8Array => bigIntToBytes(assertField(value), 32);

/** `BytesN<32>` (or its hex) → field element; rejects non-canonical values ≥ r. */
export function fieldFromBytes(bytes: Uint8Array | string): bigint {
  const b = typeof bytes === "string" ? fromHex(bytes) : bytes;
  if (b.length !== 32) throw new Error(`expected 32 bytes, got ${b.length}`);
  return assertField(bytesToBigInt(b));
}

/** Lowercase 64-char hex of a field element (the `Cpcv.commitment` / `Cpcv.nullifier` format). */
export const fieldToHex = (value: bigint): string => toHex(fieldToBytes(value));

/** Cryptographically random bytes (Web Crypto: Node ≥ 19 and browsers). */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** A random field element made of 31 random bytes (< 2^248 < r): salts and secrets. */
export const randomField31 = (): bigint => bytesToBigInt(randomBytes(31));
