// ASA request signatures. Lithic signs ASA requests like its webhooks, with
// the Standard Webhooks scheme (what the SDK's `webhooks.verifySignature`
// delegates to): once an ASA HMAC secret exists, every request carries
//   webhook-id, webhook-timestamp (unix seconds), webhook-signature
// where webhook-signature is a space-separated list of `v1,<base64>` entries
// (several during a key rotation) and each entry is
//   base64(HMAC-SHA256(key, `${id}.${timestamp}.${rawBody}`))
// with key = base64-decode(secret minus its `whsec_` prefix). Timestamps more
// than 5 minutes from now are rejected (replay protection).

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { HttpError } from "@/lib/http";

export const SIGNATURE_TOLERANCE_SECS = 5 * 60;
const SECRET_PREFIX = "whsec_";

type HeadersLike = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeadersLike, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function secretKey(secret: string): Buffer {
  const key = Buffer.from(secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret, "base64");
  if (key.length === 0) throw new Error("LITHIC_ASA_HMAC_SECRET is not a valid base64 (whsec_…) secret");
  return key;
}

/** base64 HMAC-SHA256 of `${id}.${timestamp}.${body}` (without the `v1,` prefix). */
export function computeAsaSignature(secret: string, id: string, timestamp: number, body: string): string {
  return createHmac("sha256", secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
}

const invalid = (message: string) => new HttpError(401, "INVALID_SIGNATURE", message);

/** Throws a 401 HttpError unless the request carries a valid, fresh signature for `rawBody`. */
export function verifyAsaSignature(
  rawBody: string,
  headers: HeadersLike,
  secret: string,
  nowSecs: number = Math.floor(Date.now() / 1000),
): void {
  const id = header(headers, "webhook-id");
  const timestampHeader = header(headers, "webhook-timestamp");
  const signatures = header(headers, "webhook-signature");
  if (!id || !timestampHeader || !signatures) throw invalid("Missing webhook-id/webhook-timestamp/webhook-signature headers");

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) throw invalid("Invalid webhook-timestamp header");
  if (Math.abs(nowSecs - timestamp) > SIGNATURE_TOLERANCE_SECS) throw invalid("webhook-timestamp is outside the 5-minute tolerance");

  const expected = Buffer.from(computeAsaSignature(secret, id, timestamp, rawBody));
  for (const entry of signatures.split(" ")) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    const candidate = Buffer.from(value);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return;
  }
  throw invalid("No matching webhook signature");
}

/** Signs a body the way Lithic does; for tests and local tooling. */
export function signAsaPayload(
  secret: string,
  body: string,
  opts: { id?: string; timestamp?: number } = {},
): Record<"webhook-id" | "webhook-timestamp" | "webhook-signature", string> {
  const id = opts.id ?? randomUUID();
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${computeAsaSignature(secret, id, timestamp, body)}`,
  };
}
