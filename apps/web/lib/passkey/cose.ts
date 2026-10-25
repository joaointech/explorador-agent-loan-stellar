// COSE_Key (from a WebAuthn attestation) → 65-byte uncompressed secp256r1 key,
// the form the smart account's WebAuthn signer stores (spec §9.1 Passkey.publicKeyP256).

import { createPublicKey } from "node:crypto";

import { cose, decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";

export class CoseKeyError extends Error {}

const COORD_BYTES = 32;

/**
 * Extracts the uncompressed P-256 public key (0x04 ‖ x ‖ y) from a CBOR COSE_Key.
 * Only ES256 keys on P-256 are accepted, because that is what the smart account verifies.
 */
export function coseToUncompressedP256(coseKey: Uint8Array): Uint8Array {
  let decoded: ReturnType<typeof decodeCredentialPublicKey>;
  try {
    decoded = decodeCredentialPublicKey(new Uint8Array(coseKey));
  } catch {
    throw new CoseKeyError("Passkey public key is not valid CBOR");
  }
  if (!cose.isCOSEPublicKeyEC2(decoded)) throw new CoseKeyError("Passkey public key is not an EC2 key");

  const alg = decoded.get(cose.COSEKEYS.alg);
  if (alg !== undefined && alg !== cose.COSEALG.ES256) {
    throw new CoseKeyError(`Passkey algorithm ${alg} is not ES256`);
  }
  if (decoded.get(cose.COSEKEYS.crv) !== cose.COSECRV.P256) throw new CoseKeyError("Passkey curve is not P-256");

  const x = decoded.get(cose.COSEKEYS.x);
  const y = decoded.get(cose.COSEKEYS.y);
  if (!x || !y || x.length !== COORD_BYTES || y.length !== COORD_BYTES) {
    throw new CoseKeyError("Passkey public key coordinates must be 32 bytes each");
  }

  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  assertOnCurve(raw);
  return raw;
}

/** Throws unless `raw` is a valid uncompressed P-256 point (rejects off-curve keys before they reach the chain). */
export function assertOnCurve(raw: Uint8Array): void {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new CoseKeyError("Expected a 65-byte uncompressed P-256 key");
  try {
    createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(raw.subarray(1, 33)).toString("base64url"),
        y: Buffer.from(raw.subarray(33)).toString("base64url"),
      },
      format: "jwk",
    });
  } catch {
    throw new CoseKeyError("Passkey public key is not a point on P-256");
  }
}
