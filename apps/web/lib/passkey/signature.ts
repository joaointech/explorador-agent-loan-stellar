// ECDSA P-256 signature helpers for passkey (WebAuthn) signatures.
//
// Authenticators return ASN.1 DER signatures with an unconstrained S. The
// smart account's WebAuthn verifier calls Soroban's `secp256r1_verify`, which
// takes the 64-byte compact form (r ‖ s) and rejects high-S values, so every
// passkey signature is converted and normalized before it goes on-chain.

/** Order of the secp256r1 (P-256) curve. */
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_N = P256_N / 2n;

export class SignatureFormatError extends Error {}

function readInteger(der: Uint8Array, offset: number, label: "r" | "s"): { value: bigint; end: number } {
  if (der[offset] !== 0x02) throw new SignatureFormatError(`DER: missing INTEGER tag for ${label}`);
  const length = der[offset + 1];
  if (length === undefined || length < 1 || length > 33) {
    throw new SignatureFormatError(`DER: ${label} length out of range`);
  }
  const start = offset + 2;
  const end = start + length;
  if (end > der.length) throw new SignatureFormatError(`DER: ${label} overruns the buffer`);
  const bytes = der.subarray(start, end);
  // DER integers are minimal: a leading 0x00 is only allowed before a byte with the high bit set.
  if (length > 1 && bytes[0] === 0x00 && (bytes[1]! & 0x80) === 0) {
    throw new SignatureFormatError(`DER: ${label} is not minimally encoded`);
  }
  if ((bytes[0]! & 0x80) !== 0) throw new SignatureFormatError(`DER: ${label} is negative`);
  return { value: bytesToBigInt(bytes), end };
}

/** Decodes a DER ECDSA signature into its (r, s) integers. */
export function decodeDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der.length < 8) throw new SignatureFormatError("DER: signature too short");
  if (der[0] !== 0x30) throw new SignatureFormatError("DER: missing SEQUENCE tag");
  const total = der[1]!;
  if (total >= 0x80) throw new SignatureFormatError("DER: long-form length is not used by P-256 signatures");
  if (total !== der.length - 2) throw new SignatureFormatError("DER: SEQUENCE length does not match the buffer");
  const r = readInteger(der, 2, "r");
  const s = readInteger(der, r.end, "s");
  if (s.end !== der.length) throw new SignatureFormatError("DER: trailing bytes after s");
  return { r: r.value, s: s.value };
}

/** Returns `n − s` when s is in the upper half of the curve order (low-S normalization). */
export function lowS(s: bigint): bigint {
  return s > P256_HALF_N ? P256_N - s : s;
}

/** Converts a DER signature to the 64-byte compact form (r ‖ s) with a low S. */
export function derToCompactLowS(der: Uint8Array): Uint8Array {
  const { r, s } = decodeDerSignature(der);
  if (r < 1n || r >= P256_N) throw new SignatureFormatError("Signature r is out of range");
  if (s < 1n || s >= P256_N) throw new SignatureFormatError("Signature s is out of range");
  const out = new Uint8Array(64);
  out.set(bigIntToBytes32(r), 0);
  out.set(bigIntToBytes32(lowS(s)), 32);
  return out;
}

/** Normalizes an already-compact 64-byte signature to low-S. */
export function normalizeCompactLowS(compact: Uint8Array): Uint8Array {
  if (compact.length !== 64) throw new SignatureFormatError("Compact signature must be 64 bytes");
  const r = bytesToBigInt(compact.subarray(0, 32));
  const s = bytesToBigInt(compact.subarray(32));
  if (r < 1n || r >= P256_N || s < 1n || s >= P256_N) {
    throw new SignatureFormatError("Signature component out of range");
  }
  const out = new Uint8Array(64);
  out.set(compact.subarray(0, 32), 0);
  out.set(bigIntToBytes32(lowS(s)), 32);
  return out;
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

export function bigIntToBytes32(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) throw new SignatureFormatError("Value does not fit in 32 bytes");
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
