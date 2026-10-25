// Server-side crypto helpers (Node `crypto`). Shared by route handlers and
// `tsx` scripts (the seed encrypts CPCV PII), so no `server-only` import.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { requireEnv } from "@/lib/env";

type BinaryLike = string | Uint8Array;

// ---------- hashing ----------

/** SHA-256 digest (32 raw bytes). Strings are hashed as UTF-8. */
export const sha256 = (data: BinaryLike): Buffer => createHash("sha256").update(data).digest();

/** SHA-256 digest as lowercase hex. */
export const sha256Hex = (data: BinaryLike): string => createHash("sha256").update(data).digest("hex");

/** HMAC-SHA256 as lowercase hex. */
export const hmacSha256Hex = (key: BinaryLike, data: BinaryLike): string =>
  createHmac("sha256", key).update(data).digest("hex");

/**
 * Constant-time equality for secrets (hashes, tokens, MACs). Inputs of
 * different lengths are unequal; only the length can leak, which is fine for
 * fixed-length digests.
 */
export function safeEqual(a: BinaryLike, b: BinaryLike): boolean {
  const left = typeof a === "string" ? Buffer.from(a, "utf8") : Buffer.from(a);
  const right = typeof b === "string" ? Buffer.from(b, "utf8") : Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ---------- randomness ----------

/** Uniformly random decimal digits, zero-padded (e.g. a 6-digit sign-in code). */
export function randomDigits(length: number): string {
  // crypto.randomInt needs max − min < 2^48, so 12 digits is a safe ceiling.
  if (!Number.isInteger(length) || length < 1 || length > 12) throw new RangeError("randomDigits: length must be 1…12");
  return randomInt(0, 10 ** length)
    .toString()
    .padStart(length, "0");
}

// ---------- sign-in code hashing (spec §9.2) ----------

/** Secret that keys sign-in code hashes and seals session cookies (iron-session needs ≥ 32 chars). */
export function sessionSecret(): string {
  const secret = requireEnv("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters (see apps/web/.env.example)");
  return secret;
}

/**
 * Hash stored for an email sign-in code: HMAC-SHA256 keyed with
 * SESSION_SECRET over the normalized email and the code. Binding the email
 * means a stored hash is only valid for the address it was issued to; the key
 * means a database leak alone doesn't let anyone brute-force live codes.
 */
export function hashEmailCode(email: string, code: string, secret: string = sessionSecret()): string {
  return hmacSha256Hex(secret, `advance:email-code:v1:${email}:${code}`);
}

// ---------- PII encryption (spec §9.1) ----------

const AES_ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Parses a 32-byte key given as 64 hex characters. */
export function parseKey(hex: string, name = "PII_ENCRYPTION_KEY"): Buffer {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length !== KEY_BYTES * 2) {
    throw new Error(`${name} must be ${KEY_BYTES} bytes encoded as ${KEY_BYTES * 2} hex characters`);
  }
  return Buffer.from(trimmed, "hex");
}

/** The PII key from PII_ENCRYPTION_KEY. */
export const piiKey = (): Buffer => parseKey(requireEnv("PII_ENCRYPTION_KEY"));

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new Error(`AES-256-GCM key must be ${KEY_BYTES} bytes`);
}

function seal(plaintext: Uint8Array | string, key: Uint8Array): Uint8Array<ArrayBuffer> {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([typeof plaintext === "string" ? cipher.update(plaintext, "utf8") : cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const out = new Uint8Array(IV_BYTES + TAG_BYTES + ciphertext.length);
  out.set(iv, 0);
  out.set(tag, IV_BYTES);
  out.set(ciphertext, IV_BYTES + TAG_BYTES);
  return out;
}

function unseal(blob: Uint8Array, key: Uint8Array, caller: string): Buffer {
  assertKey(key);
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error(`${caller}: ciphertext is too short`);
  const bytes = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(AES_ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(`${caller}: authentication failed (wrong key or tampered data)`);
  }
}

/**
 * Encrypts a JSON-serializable value with AES-256-GCM. Output bytes are
 * `iv (12) ‖ tag (16) ‖ ciphertext`, ready for a Prisma `Bytes` column
 * (`Cpcv.piiEncrypted`). Uses PII_ENCRYPTION_KEY unless a key is given.
 * Plain JSON only: convert bigints to strings or numbers first.
 */
export function encryptJson(value: unknown, key: Uint8Array = piiKey()): Uint8Array<ArrayBuffer> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("encryptJson: value is not JSON-serializable");
  return seal(json, key);
}

/**
 * Decrypts bytes produced by `encryptJson`. Throws if the data was tampered
 * with, truncated, or encrypted under a different key.
 */
export function decryptJson<T = unknown>(blob: Uint8Array, key: Uint8Array = piiKey()): T {
  return JSON.parse(unseal(blob, key, "decryptJson").toString("utf8")) as T;
}

/**
 * Encrypts raw bytes (e.g. an uploaded PDF, `CpcvDocument.contentEncrypted`)
 * with AES-256-GCM, in the same `iv ‖ tag ‖ ciphertext` layout as `encryptJson`.
 * Uses PII_ENCRYPTION_KEY unless a key is given.
 */
export function encryptBytes(plaintext: Uint8Array, key: Uint8Array = piiKey()): Uint8Array<ArrayBuffer> {
  return seal(plaintext, key);
}

/** Decrypts bytes produced by `encryptBytes`. Throws on tampering, truncation or a different key. */
export function decryptBytes(blob: Uint8Array, key: Uint8Array = piiKey()): Uint8Array<ArrayBuffer> {
  const plaintext = unseal(blob, key, "decryptBytes");
  const out = new Uint8Array(plaintext.length);
  out.set(plaintext);
  return out;
}
