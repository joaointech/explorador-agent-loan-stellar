import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  P256_N,
  SignatureFormatError,
  bigIntToBytes32,
  bytesToBigInt,
  decodeDerSignature,
  derToCompactLowS,
  normalizeCompactLowS,
} from "./signature";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

/** Minimal DER encoder for (r, s), used to build edge cases. */
function der(r: bigint, s: bigint): Buffer {
  const int = (v: bigint) => {
    let bytes = Buffer.from(bigIntToBytes32(v));
    while (bytes.length > 1 && bytes[0] === 0 && (bytes[1]! & 0x80) === 0) bytes = bytes.subarray(1);
    if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const body = Buffer.concat([int(r), int(s)]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

describe("derToCompactLowS", () => {
  it("converts real authenticator-style DER signatures to verifiable 64-byte low-S signatures", () => {
    for (let i = 0; i < 40; i++) {
      const message = randomBytes(64);
      const signature = sign("sha256", message, { key: privateKey, dsaEncoding: "der" });
      const compact = derToCompactLowS(signature);
      expect(compact).toHaveLength(64);
      expect(bytesToBigInt(compact.subarray(32))).toBeLessThanOrEqual(P256_N / 2n);
      expect(verify("sha256", message, { key: publicKey, dsaEncoding: "ieee-p1363" }, compact)).toBe(true);
    }
  });

  it("flips a high S to n − S (the signature stays valid)", () => {
    const message = randomBytes(32);
    const original = decodeDerSignature(sign("sha256", message, { key: privateKey, dsaEncoding: "der" }));
    const lowS = original.s > P256_N / 2n ? P256_N - original.s : original.s;
    const highS = P256_N - lowS;
    const compact = derToCompactLowS(der(original.r, highS));
    expect(bytesToBigInt(compact.subarray(0, 32))).toBe(original.r);
    expect(bytesToBigInt(compact.subarray(32))).toBe(lowS);
    expect(verify("sha256", message, { key: publicKey, dsaEncoding: "ieee-p1363" }, compact)).toBe(true);
  });

  it("left-pads short integers and strips the DER sign byte", () => {
    const compact = derToCompactLowS(der(0x80n, 5n)); // r needs a 0x00 sign byte in DER
    expect(Buffer.from(compact.subarray(0, 32)).toString("hex")).toBe("80".padStart(64, "0"));
    expect(Buffer.from(compact.subarray(32)).toString("hex")).toBe("05".padStart(64, "0"));
  });

  it("rejects malformed DER", () => {
    const good = der(12345n, 67890n);
    const cases: Buffer[] = [
      Buffer.from([0x31, ...good.subarray(1)]), // wrong SEQUENCE tag
      Buffer.from([0x30, good[1]! + 1, ...good.subarray(2)]), // length mismatch
      Buffer.concat([good, Buffer.from([0])]), // trailing byte
      Buffer.from([0x30, 0x08, 0x03, 0x02, 0x01, 0x01, 0x02, 0x02, 0x01, 0x01]), // r is not an INTEGER
      Buffer.from([0x30, 0x08, 0x02, 0x02, 0x00, 0x01, 0x02, 0x02, 0x00, 0x01]), // non-minimal integers
      Buffer.from([0x30, 0x06, 0x02, 0x01, 0x81, 0x02, 0x01, 0x01]), // negative r
      Buffer.from([0x30, 0x02, 0x02, 0x00]), // too short
    ];
    for (const bad of cases) expect(() => derToCompactLowS(bad)).toThrow(SignatureFormatError);
  });

  it("rejects r or s outside [1, n)", () => {
    expect(() => derToCompactLowS(der(0n, 1n))).toThrow(SignatureFormatError);
    expect(() => derToCompactLowS(der(1n, P256_N))).toThrow(SignatureFormatError);
  });
});

describe("normalizeCompactLowS", () => {
  it("normalizes S of a compact signature and keeps R", () => {
    const r = 7n;
    const highS = P256_N - 11n;
    const compact = new Uint8Array([...bigIntToBytes32(r), ...bigIntToBytes32(highS)]);
    const out = normalizeCompactLowS(compact);
    expect(bytesToBigInt(out.subarray(0, 32))).toBe(r);
    expect(bytesToBigInt(out.subarray(32))).toBe(11n);
  });

  it("requires 64 bytes", () => {
    expect(() => normalizeCompactLowS(new Uint8Array(63))).toThrow(SignatureFormatError);
  });
});
