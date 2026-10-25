import { env } from "@/lib/env";

/** ES256 (ECDSA P-256 / SHA-256): the only algorithm the smart account's WebAuthn verifier supports. */
export const ES256 = -7;

export const WEBAUTHN_TIMEOUT_MS = 120_000;

/** Relying party settings (spec §9.2): rpID from WEBAUTHN_RP_ID, expected origin from APP_URL. */
export function webauthnConfig() {
  const e = env();
  return { rpID: e.WEBAUTHN_RP_ID, rpName: e.WEBAUTHN_RP_NAME, origin: new URL(e.APP_URL).origin };
}
