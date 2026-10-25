// ASA responder enrollment (spec §9.4), used by `pnpm lithic:enroll`:
// Lithic "Enroll a responder endpoint" (`responderEndpoints.create`, type
// AUTH_STREAM_ACCESS), then "Retrieve the ASA HMAC secret key"
// (`authStreamEnrollment.retrieveSecret`), which creates the secret on first
// call; Lithic starts sending webhook-* signature headers shortly after.

import { getLithic } from "./client";
import { createSpacer } from "./rate-limit";

export const ASA_PATH = "/api/lithic/asa";
const TYPE = "AUTH_STREAM_ACCESS" as const;

// Sandbox `responder_endpoints` resource: 1 write per second.
const responderWrites = createSpacer(1_100);

export const asaResponderUrl = (appUrl: string): string => new URL(ASA_PATH, appUrl).toString();

/** Lithic can only reach public http(s) URLs (use a tunnel for local dev). */
export function isPublicUrl(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") return false;
  return !/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(hostname) && !hostname.endsWith(".local");
}

export interface ResponderStatus {
  enrolled: boolean;
  url: string | null;
}

export async function asaResponderStatus(): Promise<ResponderStatus> {
  const status = await getLithic().responderEndpoints.checkStatus({ type: TYPE });
  return { enrolled: Boolean(status.enrolled), url: status.url ?? null };
}

export interface AsaEnrollment {
  url: string;
  /** The URL enrolled before, if it was a different one. */
  replaced: string | null;
  /** `whsec_…`: LITHIC_ASA_HMAC_SECRET. */
  secret: string;
}

/** Enrolls `${appUrl}/api/lithic/asa` (replacing a different enrolled URL) and returns the ASA HMAC secret. */
export async function enrollAsaResponder(appUrl: string): Promise<AsaEnrollment> {
  const lithic = getLithic();
  const url = asaResponderUrl(appUrl);
  const before = await asaResponderStatus();
  const replaced = before.enrolled && before.url !== url ? before.url : null;

  if (replaced) await responderWrites(() => lithic.responderEndpoints.delete({ type: TYPE }));
  if (!before.enrolled || replaced) {
    const res = await responderWrites(() => lithic.responderEndpoints.create({ type: TYPE, url }));
    if (res.enrolled === false) throw new Error(`Lithic did not enroll ${url}`);
  }

  const { secret } = await lithic.authStreamEnrollment.retrieveSecret();
  if (!secret) throw new Error("Lithic returned no ASA HMAC secret");
  return { url, replaced, secret };
}

export async function disenrollAsaResponder(): Promise<void> {
  await responderWrites(() => getLithic().responderEndpoints.delete({ type: TYPE }));
}
