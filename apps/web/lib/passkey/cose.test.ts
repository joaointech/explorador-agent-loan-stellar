import { generateKeyPairSync } from "node:crypto";

import { isoCBOR } from "@simplewebauthn/server/helpers";
import { describe, expect, it } from "vitest";

import { CoseKeyError, assertOnCurve, coseToUncompressedP256 } from "./cose";
import { createSoftwarePasskey } from "./software-authenticator";

function coseKey(fields: [number, number | Uint8Array][]): Uint8Array {
  return isoCBOR.encode(new Map(fields));
}

function p256Coords() {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  return { x: new Uint8Array(Buffer.from(jwk.x!, "base64url")), y: new Uint8Array(Buffer.from(jwk.y!, "base64url")) };
}

describe("coseToUncompressedP256", () => {
  it("extracts 0x04 ‖ x ‖ y from an ES256 COSE key", () => {
    const passkey = createSoftwarePasskey();
    const raw = coseToUncompressedP256(passkey.publicKeyCose);
    expect(raw).toHaveLength(65);
    expect(raw[0]).toBe(0x04);
    expect(Buffer.from(raw).equals(Buffer.from(passkey.publicKeyP256))).toBe(true);
  });

  it("accepts a key without the optional alg field", () => {
    const { x, y } = p256Coords();
    const raw = coseToUncompressedP256(coseKey([[1, 2], [-1, 1], [-2, x], [-3, y]]));
    expect(Buffer.from(raw.subarray(1, 33)).equals(Buffer.from(x))).toBe(true);
  });

  it("rejects keys the smart account cannot verify", () => {
    const { x, y } = p256Coords();
    const cases: [string, Uint8Array][] = [
      ["OKP / Ed25519", coseKey([[1, 1], [3, -8], [-1, 6], [-2, x]])],
      ["RSA", coseKey([[1, 3], [3, -257], [-1, new Uint8Array(256)], [-2, new Uint8Array([1, 0, 1])]])],
      ["ES384 alg", coseKey([[1, 2], [3, -35], [-1, 1], [-2, x], [-3, y]])],
      ["P-384 curve", coseKey([[1, 2], [3, -7], [-1, 2], [-2, x], [-3, y]])],
      ["short x", coseKey([[1, 2], [3, -7], [-1, 1], [-2, x.subarray(1)], [-3, y]])],
      ["missing y", coseKey([[1, 2], [3, -7], [-1, 1], [-2, x]])],
    ];
    for (const [label, key] of cases) {
      expect(() => coseToUncompressedP256(key), label).toThrow(CoseKeyError);
    }
  });

  it("rejects a point that is not on P-256", () => {
    const { x, y } = p256Coords();
    const badY = new Uint8Array(y);
    badY[31] = badY[31]! ^ 0x01;
    expect(() => coseToUncompressedP256(coseKey([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, badY]]))).toThrow(
      /not a point on P-256/,
    );
  });

  it("rejects bytes that are not CBOR", () => {
    expect(() => coseToUncompressedP256(new Uint8Array([0xff, 0x00, 0x13]))).toThrow(CoseKeyError);
  });
});

describe("assertOnCurve", () => {
  it("requires the uncompressed prefix and length", () => {
    const passkey = createSoftwarePasskey();
    expect(() => assertOnCurve(passkey.publicKeyP256)).not.toThrow();
    const compressed = new Uint8Array(passkey.publicKeyP256);
    compressed[0] = 0x02;
    expect(() => assertOnCurve(compressed)).toThrow(CoseKeyError);
    expect(() => assertOnCurve(passkey.publicKeyP256.subarray(0, 64))).toThrow(CoseKeyError);
  });
});
