// WebAuthn (passkey) registration and discoverable sign-in (§9.2) with @simplewebauthn/server.
// One passkey is used for both login and the agent's smart-account signer, so only
// ES256 (secp256r1) credentials are accepted.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

export function expectedOrigins(): string[] {
  const origins = new Set<string>([env.appUrl]);
  if (env.rpId === "localhost") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return [...origins];
}

/** COSE EC2 P-256 key → 65-byte uncompressed point 0x04 ‖ x ‖ y. */
export function coseToUncompressedP256(cosePublicKey: Uint8Array): Uint8Array<ArrayBuffer> {
  const decoded = decodeCredentialPublicKey(cosePublicKey as Uint8Array<ArrayBuffer>) as unknown as Map<number, unknown>;
  const kty = decoded.get(1);
  const crv = decoded.get(-1);
  const x = decoded.get(-2) as Uint8Array | undefined;
  const y = decoded.get(-3) as Uint8Array | undefined;
  if (kty !== 2 || crv !== 1 || !x || !y || x.length !== 32 || y.length !== 32) {
    throw new HttpError(400, "UNSUPPORTED_KEY", "The passkey must use a P-256 (ES256) key");
  }
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

export async function registrationOptions(user: { id: string; email: string; displayName?: string | null }) {
  const existing = await db.passkey.findMany({ where: { userId: user.id } });
  return generateRegistrationOptions({
    rpName: env.rpName,
    rpID: env.rpId,
    userName: user.email,
    userDisplayName: user.displayName ?? user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7],
    timeout: 60_000,
  });
}

export async function verifyRegistration(userId: string, response: RegistrationResponseJSON, expectedChallenge: string) {
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins(),
    expectedRPID: env.rpId,
    requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) throw new HttpError(400, "PASSKEY_INVALID", "Passkey registration could not be verified");
  const { credential } = v.registrationInfo;
  const p256 = coseToUncompressedP256(credential.publicKey);
  return db.passkey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKeyCose: new Uint8Array(credential.publicKey),
      publicKeyP256: p256,
      counter: credential.counter,
      transports: (credential.transports ?? []) as string[],
    },
  });
}

export async function authenticationOptions() {
  return generateAuthenticationOptions({ rpID: env.rpId, userVerification: "required", timeout: 60_000 });
}

export async function verifyAuthentication(response: AuthenticationResponseJSON, expectedChallenge: string) {
  const passkey = await db.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
  if (!passkey) throw new HttpError(400, "PASSKEY_UNKNOWN", "This passkey is not registered");
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins(),
    expectedRPID: env.rpId,
    requireUserVerification: true,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKeyCose),
      counter: passkey.counter,
      transports: passkey.transports as never,
    },
  });
  if (!v.verified) throw new HttpError(400, "PASSKEY_INVALID", "Passkey sign-in failed");
  await db.passkey.update({ where: { id: passkey.id }, data: { counter: v.authenticationInfo.newCounter } });
  return passkey.user;
}
