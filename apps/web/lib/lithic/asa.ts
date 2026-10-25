// Lithic Auth Stream Access (ASA) wire format: the request Lithic POSTs to
// /api/lithic/asa and the response it expects (docs.lithic.com, "Auth Stream
// Access Request"). Only the fields the responder uses are validated; the
// rest of the payload is passed through untouched.

import { z } from "zod";

import { badRequest } from "@/lib/http";

/** `status` values Lithic sends (CREDIT_* only with credit decisioning enabled). */
export const ASA_STATUSES = [
  "AUTHORIZATION",
  "CREDIT_AUTHORIZATION",
  "FINANCIAL_AUTHORIZATION",
  "FINANCIAL_CREDIT_AUTHORIZATION",
  "BALANCE_INQUIRY",
] as const;
export type AsaStatus = (typeof ASA_STATUSES)[number];

/** Every `result` Lithic accepts; anything else declines with CUSTOM_ASA_RESULT. */
export const ASA_RESULTS = [
  "APPROVED",
  "AVS_INVALID",
  "CARD_PAUSED",
  "INSUFFICIENT_FUNDS",
  "UNAUTHORIZED_MERCHANT",
  "VELOCITY_EXCEEDED",
  "DRIVER_NUMBER_INVALID",
  "VEHICLE_NUMBER_INVALID",
  "SUSPECTED_FRAUD",
  "CHALLENGE",
] as const;
export type AsaResult = (typeof ASA_RESULTS)[number];

export const isAsaResult = (value: unknown): value is AsaResult =>
  typeof value === "string" && (ASA_RESULTS as readonly string[]).includes(value);

/** Response body (HTTP 200). `balance` is only meaningful for BALANCE_INQUIRY; amounts in cents. */
export interface AsaResponse {
  result: AsaResult;
  /** Echo of the request's transaction token (optional in Lithic's schema). */
  token?: string;
  balance?: { amount: number; available: number };
}

const int = z.number().int();

export const asaRequestSchema = z.looseObject({
  /** Transaction token: stable across Lithic's retries of the same authorization. */
  token: z.string().min(1).max(200),
  /** Kept as a free string so future statuses fall into the "other" branch instead of a 400. */
  status: z.string().min(1),
  /** Deprecated by Lithic in favour of `amounts`, still always sent. Cents. */
  amount: int.optional(),
  amounts: z
    .looseObject({ cardholder: z.looseObject({ amount: int }).nullish() })
    .nullish(),
  card: z.looseObject({ token: z.string().min(1), last_four: z.string().optional() }),
  merchant: z.looseObject({ descriptor: z.string().optional() }).nullish(),
});

export type AsaRequest = z.infer<typeof asaRequestSchema>;

/** Parses and validates a raw ASA body; throws a 400 HttpError when it isn't one. */
export function parseAsaRequest(raw: string): AsaRequest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badRequest("ASA body must be valid JSON", "INVALID_ASA_REQUEST");
  }
  const parsed = asaRequestSchema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw badRequest(`Invalid ASA request: ${message}`, "INVALID_ASA_REQUEST");
  }
  if (asaAmountCents(parsed.data) === null) {
    throw badRequest("Invalid ASA request: no amount", "INVALID_ASA_REQUEST");
  }
  return parsed.data;
}

/** `amounts.cardholder.amount ?? amount`, in cents (USD in Lithic sandbox; treated as EUR 1:1, spec §2). */
export function asaAmountCents(req: AsaRequest): bigint | null {
  const cents = req.amounts?.cardholder?.amount ?? req.amount;
  return cents === undefined ? null : BigInt(cents);
}

export function asaMerchant(req: AsaRequest): string {
  const name = req.merchant?.descriptor?.trim();
  return name ? name.slice(0, 255) : "Unknown merchant";
}
