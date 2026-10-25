// BN254 constants and byte encodings (§8.4). All 32-byte values are big-endian.

/** BN254 scalar field modulus r. */
export const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/** BN254 base field modulus p. */
export const FP = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

export const DAY_SECS = 86_400;
export const STROOPS_PER_CENT = 100_000n;

export function toHex32(v: bigint): string {
  if (v < 0n) throw new Error("negative field value");
  const h = v.toString(16);
  if (h.length > 64) throw new Error("value does not fit in 32 bytes");
  return h.padStart(64, "0");
}

export function fromHex(hex: string): bigint {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.length === 0 ? 0n : BigInt("0x" + h);
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Days since the Unix epoch (UTC). */
export function unixDay(unixSeconds: number): number {
  return Math.floor(unixSeconds / DAY_SECS);
}

export function dayFromDate(date: Date): number {
  return Math.floor(date.getTime() / 1000 / DAY_SECS);
}

export function dateFromDay(day: number): Date {
  return new Date(day * DAY_SECS * 1000);
}

export function centsToStroops(cents: bigint): bigint {
  return cents * STROOPS_PER_CENT;
}

/** A random field element made of 31 random bytes (always < r). */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(31);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBigInt(bytes);
}
