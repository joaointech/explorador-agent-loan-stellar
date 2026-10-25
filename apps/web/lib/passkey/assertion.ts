// Server-side checks of a WebAuthn assertion that signs a smart-account auth
// digest, before it is sent on-chain. The WebAuthn verifier contract checks the
// type, challenge, UP/UV flags and the signature; it deliberately skips origin
// and RP ID, so those are enforced here.

import { createHash, createPublicKey, verify } from "node:crypto";

import { assertOnCurve } from "./cose";
import { derToCompactLowS, SignatureFormatError } from "./signature";

/** Limit enforced by the verifier contract (CLIENT_DATA_MAX_LEN). */
export const CLIENT_DATA_MAX_BYTES = 1024;
const AUTH_DATA_MIN_BYTES = 37;

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;

export class AssertionError extends Error {}

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

export function parseClientData(clientDataJSON: Uint8Array): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(clientDataJSON).toString("utf8"));
  } catch {
    throw new AssertionError("clientDataJSON is not valid JSON");
  }
  const c = parsed as Partial<ClientData>;
  if (typeof c?.type !== "string" || typeof c.challenge !== "string" || typeof c.origin !== "string") {
    throw new AssertionError("clientDataJSON is missing type, challenge or origin");
  }
  return { type: c.type, challenge: c.challenge, origin: c.origin, crossOrigin: c.crossOrigin };
}

export function authenticatorFlags(authenticatorData: Uint8Array) {
  if (authenticatorData.length < AUTH_DATA_MIN_BYTES) throw new AssertionError("authenticatorData is too short");
  const flags = authenticatorData[32]!;
  return {
    userPresent: (flags & FLAG_UP) !== 0,
    userVerified: (flags & FLAG_UV) !== 0,
    backupEligible: (flags & FLAG_BE) !== 0,
    backedUp: (flags & FLAG_BS) !== 0,
  };
}

/** ECDSA-P256/SHA-256 over authenticatorData ‖ sha256(clientDataJSON), with the stored 65-byte key. */
export function verifyAssertionSignature(
  publicKeyP256: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  derSignature: Uint8Array,
): boolean {
  assertOnCurve(publicKeyP256);
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: Buffer.from(publicKeyP256.subarray(1, 33)).toString("base64url"),
      y: Buffer.from(publicKeyP256.subarray(33)).toString("base64url"),
    },
    format: "jwk",
  });
  const signed = Buffer.concat([Buffer.from(authenticatorData), sha256(clientDataJSON)]);
  try {
    return verify("sha256", signed, { key, dsaEncoding: "der" }, Buffer.from(derSignature));
  } catch {
    return false;
  }
}

/**
 * Validates an assertion over `expectedChallenge` (the auth digest) and returns the compact low-S
 * signature for `WebAuthnSigData`. Throws AssertionError with a user-facing reason otherwise.
 */
export function checkSigningAssertion(input: {
  publicKeyP256: Uint8Array;
  expectedChallenge: Uint8Array;
  expectedOrigin: string;
  rpID: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}): Uint8Array {
  if (input.clientDataJSON.length > CLIENT_DATA_MAX_BYTES) throw new AssertionError("clientDataJSON is too long");
  const clientData = parseClientData(input.clientDataJSON);
  if (clientData.type !== "webauthn.get") throw new AssertionError("Not a WebAuthn authentication assertion");
  if (clientData.challenge !== Buffer.from(input.expectedChallenge).toString("base64url")) {
    throw new AssertionError("The passkey signed a different transaction; prepare it again");
  }
  if (clientData.origin !== input.expectedOrigin) throw new AssertionError(`Unexpected origin ${clientData.origin}`);

  const flags = authenticatorFlags(input.authenticatorData);
  if (!Buffer.from(input.authenticatorData.subarray(0, 32)).equals(sha256(Buffer.from(input.rpID)))) {
    throw new AssertionError("The passkey belongs to a different site");
  }
  if (!flags.userPresent || !flags.userVerified) throw new AssertionError("User verification is required");
  if (flags.backedUp && !flags.backupEligible) throw new AssertionError("Invalid authenticator backup flags");

  if (!verifyAssertionSignature(input.publicKeyP256, input.authenticatorData, input.clientDataJSON, input.signature)) {
    throw new AssertionError("Passkey signature is not valid for this account");
  }
  try {
    return derToCompactLowS(input.signature);
  } catch (err) {
    throw new AssertionError(err instanceof SignatureFormatError ? err.message : "Malformed signature");
  }
}
