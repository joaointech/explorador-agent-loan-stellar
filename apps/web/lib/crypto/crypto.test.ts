import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY = "11".repeat(32);
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
});

import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  hashEmailCode,
  hmacSha256Hex,
  parseKey,
  randomDigits,
  safeEqual,
  sha256,
  sha256Hex,
} from "@/lib/crypto";

const pii = {
  buyerName: "Maria João Silva",
  buyerNif: "123456789",
  sellerName: "José Pereira",
  sellerNif: "987654321",
  propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
  salePriceCents: 30_000_000,
  commissionRateBps: 500,
  cpcvDate: "2027-01-14",
};

describe("AES-256-GCM JSON encryption", () => {
  it("round-trips with the PII_ENCRYPTION_KEY from env", () => {
    const blob = encryptJson(pii);
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(decryptJson(blob)).toEqual(pii);
  });

  it("round-trips with an explicit key", () => {
    const key = parseKey("ab".repeat(32));
    expect(decryptJson(encryptJson({ a: [1, "two", null] }, key), key)).toEqual({ a: [1, "two", null] });
  });

  it("lays out iv (12) ‖ tag (16) ‖ ciphertext and uses a fresh iv every time", () => {
    const a = encryptJson("x");
    const b = encryptJson("x");
    expect(a.length).toBe(12 + 16 + Buffer.byteLength(JSON.stringify("x")));
    expect(Buffer.from(a.subarray(0, 12)).equals(Buffer.from(b.subarray(0, 12)))).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it.each([
    ["iv", 0],
    ["tag", 12],
    ["ciphertext", 28],
  ])("detects a flipped bit in the %s", (_part, offset) => {
    const blob = encryptJson(pii);
    const tampered = new Uint8Array(blob);
    tampered[offset]! ^= 0x01;
    expect(() => decryptJson(tampered)).toThrow(/authentication failed/);
  });

  it("rejects a different key, truncated data and appended bytes", () => {
    const blob = encryptJson(pii);
    expect(() => decryptJson(blob, parseKey("22".repeat(32)))).toThrow(/authentication failed/);
    expect(() => decryptJson(blob.subarray(0, 20))).toThrow(/too short/);
    expect(() => decryptJson(blob.subarray(0, blob.length - 1))).toThrow(/authentication failed/);
    const longer = new Uint8Array(blob.length + 1);
    longer.set(blob);
    expect(() => decryptJson(longer)).toThrow(/authentication failed/);
  });

  it("decrypts from a Buffer view with a non-zero byteOffset (as drivers may return)", () => {
    const blob = encryptJson(pii);
    const padded = Buffer.concat([Buffer.alloc(7), Buffer.from(blob)]);
    expect(decryptJson(padded.subarray(7))).toEqual(pii);
  });

  it("validates key format", () => {
    expect(() => parseKey("abc")).toThrow(/64 hex characters/);
    expect(() => parseKey("zz".repeat(32))).toThrow(/64 hex characters/);
    expect(() => encryptJson(pii, new Uint8Array(16))).toThrow(/32 bytes/);
    expect(parseKey(` ${"AB".repeat(32)} `)).toHaveLength(32);
  });

  it("refuses values JSON can't represent", () => {
    expect(() => encryptJson(undefined)).toThrow(TypeError);
    expect(() => encryptJson({ n: 1n })).toThrow();
  });
});

describe("AES-256-GCM byte encryption (uploaded PDFs)", () => {
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n% fake contract bytes ção\n%%EOF\n", "utf8"));

  it("round-trips raw bytes with the PII key, in the same iv ‖ tag ‖ ciphertext layout", () => {
    const blob = encryptBytes(pdf);
    expect(blob.length).toBe(12 + 16 + pdf.length);
    expect(Buffer.from(blob).includes(Buffer.from("%PDF"))).toBe(false);
    expect(Buffer.from(decryptBytes(blob)).equals(Buffer.from(pdf))).toBe(true);
  });

  it("is interchangeable with the JSON helpers' format", () => {
    const blob = encryptBytes(new TextEncoder().encode(JSON.stringify({ a: 1 })));
    expect(decryptJson(blob)).toEqual({ a: 1 });
    expect(new TextDecoder().decode(decryptBytes(encryptJson({ b: 2 })))).toBe('{"b":2}');
  });

  it("detects tampering, truncation and a different key", () => {
    const blob = encryptBytes(pdf);
    const tampered = new Uint8Array(blob);
    tampered[blob.length - 1]! ^= 0x80;
    expect(() => decryptBytes(tampered)).toThrow(/decryptBytes: authentication failed/);
    expect(() => decryptBytes(blob.subarray(0, 27))).toThrow(/too short/);
    expect(() => decryptBytes(blob, parseKey("22".repeat(32)))).toThrow(/authentication failed/);
  });

  it("handles an empty file", () => {
    expect(decryptBytes(encryptBytes(new Uint8Array(0)))).toHaveLength(0);
  });
});

describe("hash helpers", () => {
  it("sha256 matches the FIPS 180-2 'abc' vector", () => {
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256Hex("abc")).toBe(expected);
    expect(sha256(new TextEncoder().encode("abc")).toString("hex")).toBe(expected);
    expect(sha256("abc")).toHaveLength(32);
  });

  it("hmacSha256Hex matches RFC 4231 test case 2", () => {
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("safeEqual compares in constant time and handles length mismatches", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
  });

  it("hashEmailCode is keyed with SESSION_SECRET and bound to email + code", () => {
    const h = hashEmailCode("ana@demo.explorador.pt", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmailCode("ana@demo.explorador.pt", "123456")).toBe(h);
    expect(hashEmailCode("bruno@demo.explorador.pt", "123456")).not.toBe(h);
    expect(hashEmailCode("ana@demo.explorador.pt", "123457")).not.toBe(h);
    expect(hashEmailCode("ana@demo.explorador.pt", "123456", "another-secret-0123456789abcdefgh")).not.toBe(h);
    // Not a bare SHA-256 of the code: the secret matters.
    expect(h).not.toBe(sha256Hex("123456"));
  });
});

describe("randomDigits", () => {
  it("returns zero-padded digit strings of the requested length", () => {
    for (let i = 0; i < 500; i++) expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(randomDigits(1)).toMatch(/^\d$/);
    expect(randomDigits(12)).toMatch(/^\d{12}$/);
  });

  it("covers the whole range, including leading zeros", () => {
    const firstDigits = new Set(Array.from({ length: 2000 }, () => randomDigits(6)[0]));
    expect(firstDigits.has("0")).toBe(true);
    expect(firstDigits.size).toBe(10);
  });

  it("rejects bad lengths", () => {
    expect(() => randomDigits(0)).toThrow(RangeError);
    expect(() => randomDigits(13)).toThrow(RangeError);
    expect(() => randomDigits(2.5)).toThrow(RangeError);
  });
});
