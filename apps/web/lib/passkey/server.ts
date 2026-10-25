// Passkey ceremonies (spec §9.2) with @simplewebauthn/server v14. One passkey is
// both the login credential and, for agents, the smart account's signer.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";

import { roleForEmail } from "@/lib/auth/users";
import { db, type Role } from "@/lib/db";
import { badRequest, conflict, HttpError, unauthorized } from "@/lib/http";

import { ES256, WEBAUTHN_TIMEOUT_MS, webauthnConfig } from "./config";
import { CoseKeyError, coseToUncompressedP256 } from "./cose";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, "must be base64url");

/** Shape check for `startRegistration()` output; the cryptographic checks happen in verifyRegistrationResponse. */
export const registrationResponseSchema = z.looseObject({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.string()).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});

/** Shape check for `startAuthentication()` output. */
export const authenticationResponseSchema = z.looseObject({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});

export async function buildRegistrationOptions(user: { userId: string; email: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = webauthnConfig();
  const existing = await db.passkey.findMany({ where: { userId: user.userId }, select: { credentialId: true, transports: true } });
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.email,
    userID: new TextEncoder().encode(user.userId),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    // Discoverable so the passkey can sign in without a username; UV because the verifier contract requires it.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [ES256],
    timeout: WEBAUTHN_TIMEOUT_MS,
  });
}

/** Verifies the attestation and stores the passkey with its 65-byte P-256 key (spec §9.1 Passkey). */
export async function completeRegistration(
  user: { userId: string },
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<{ credentialId: string; publicKeyP256: Uint8Array }> {
  const { rpID, origin } = webauthnConfig();
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [ES256],
    });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Passkey registration failed", "PASSKEY_INVALID");
  }
  if (!verification.verified) throw badRequest("Passkey registration could not be verified", "PASSKEY_INVALID");

  const { credential } = verification.registrationInfo;
  let publicKeyP256: Uint8Array;
  try {
    publicKeyP256 = coseToUncompressedP256(credential.publicKey);
  } catch (err) {
    throw badRequest(err instanceof CoseKeyError ? err.message : "Unsupported passkey key", "PASSKEY_UNSUPPORTED");
  }

  const taken = await db.passkey.findUnique({ where: { credentialId: credential.id }, select: { userId: true } });
  if (taken) throw conflict("This passkey is already registered", "PASSKEY_EXISTS");

  await db.passkey.create({
    data: {
      userId: user.userId,
      credentialId: credential.id,
      publicKeyCose: new Uint8Array(credential.publicKey),
      publicKeyP256: new Uint8Array(publicKeyP256),
      counter: credential.counter,
      transports: credential.transports ?? response.response.transports ?? [],
    },
  });
  return { credentialId: credential.id, publicKeyP256 };
}

/** Discoverable-credential sign-in: no allowCredentials, the authenticator offers the user's passkeys. */
export async function buildLoginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = webauthnConfig();
  return generateAuthenticationOptions({ rpID, userVerification: "required", timeout: WEBAUTHN_TIMEOUT_MS });
}

export async function completeLogin(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<{ id: string; email: string; role: Role }> {
  const { rpID, origin } = webauthnConfig();
  const passkey = await db.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
  if (!passkey) throw unauthorized("Unknown passkey: sign in with your email code and register it again");

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKeyCose),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    throw new HttpError(401, "PASSKEY_INVALID", err instanceof Error ? err.message : "Passkey sign-in failed");
  }
  if (!verification.verified) throw new HttpError(401, "PASSKEY_INVALID", "Passkey sign-in could not be verified");

  await db.passkey.update({ where: { id: passkey.id }, data: { counter: verification.authenticationInfo.newCounter } });
  // ADMIN_EMAILS is the source of truth for the role, as on email sign-in: a passkey
  // must not let someone removed from the list keep signing in as admin.
  const role = roleForEmail(passkey.user.email);
  if (role !== passkey.user.role) await db.user.update({ where: { id: passkey.user.id }, data: { role } });
  return { id: passkey.user.id, email: passkey.user.email, role };
}
