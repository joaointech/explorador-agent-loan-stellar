// Validation of the New CPCV form (spec §4.3, §8.2–8.3), shared by the form
// (client-side errors) and POST /api/admin/cpcv. Pure: no server imports, so
// the browser bundle stays small.
//
// The circuit's own checks (NIF digits, rate 100–1000 bps, cpcv < escritura,
// commission > 0) are repeated here so the admin sees a readable message before
// any proving starts; `protocolDateIssues` adds the checks that need the
// protocol clock (the escritura must be after today's protocol date, which
// cpcv_note.mint enforces on-chain).

import { z } from "zod";

import { formatDate } from "@/lib/format";
import type { AdminCpcvInput } from "@/lib/types/api";

import { previewCommission } from "./commission";

export const NIF_PATTERN = /^\d{9}$/;
export const MIN_RATE_BPS = 100;
export const MAX_RATE_BPS = 1000;
/** €100,000,000: far above any Portuguese sale, far below the circuit's 64-bit range. */
export const MAX_SALE_PRICE_CENTS = 10_000_000_000;
/** property_hash takes at most 8 × 31 UTF-8 bytes of the normalized address (lib/zk/poseidon). */
export const MAX_ADDRESS_BYTES = 248;

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → days since the Unix epoch (UTC, spec §8.4); null if it is not a real calendar date. */
export function isoDateToDay(value: string): number | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2099) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return Math.floor(ms / DAY_MS);
}

/** Day number → `YYYY-MM-DD` (UTC). */
export const dayToIsoDate = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Same normalization as property_hash (NFC, lowercase, trimmed, single spaces), for the length check. */
const normalizedAddressBytes = (address: string) =>
  new TextEncoder().encode(address.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ")).length;

const isoDate = z
  .string()
  .trim()
  .regex(ISO_DATE, "Use the format YYYY-MM-DD")
  .refine((v) => isoDateToDay(v) !== null, "Not a valid date");

const nif = z.string().trim().regex(NIF_PATTERN, "A NIF has exactly 9 digits");

export const adminCpcvInputSchema = z
  .object({
    agentId: z.string().trim().min(1, "Choose an agent"),
    buyerName: z.string().trim().min(2, "Enter the buyer's name").max(120),
    buyerNif: nif,
    sellerName: z.string().trim().min(2, "Enter the seller's name").max(120),
    sellerNif: nif,
    propertyAddress: z
      .string()
      .trim()
      .min(5, "Enter the property address")
      .max(200)
      .refine((v) => normalizedAddressBytes(v) <= MAX_ADDRESS_BYTES, `The address is too long (max ${MAX_ADDRESS_BYTES} bytes)`),
    // `error` covers a missing or unparsable amount (the form sends NaN for an empty field).
    salePriceCents: z
      .number({ error: "Enter the sale price" })
      .int("Sale price must be in whole cents")
      .positive("Enter the sale price")
      .max(MAX_SALE_PRICE_CENTS, "Sale price is above €100,000,000"),
    commissionRateBps: z
      .number({ error: "Enter the commission rate" })
      .int("Commission rate must be whole basis points")
      .min(MIN_RATE_BPS, "Commission rate must be at least 1%")
      .max(MAX_RATE_BPS, "Commission rate must be at most 10%"),
    cpcvDate: isoDate,
    escrituraDate: isoDate,
  })
  .superRefine((v, ctx) => {
    if (v.buyerNif === v.sellerNif) {
      ctx.addIssue({ code: "custom", path: ["sellerNif"], message: "Buyer and seller can't have the same NIF" });
    }
    const cpcvDay = isoDateToDay(v.cpcvDate);
    const escrituraDay = isoDateToDay(v.escrituraDate);
    if (cpcvDay !== null && escrituraDay !== null && escrituraDay <= cpcvDay) {
      ctx.addIssue({ code: "custom", path: ["escrituraDate"], message: "The escritura must be after the CPCV" });
    }
    if (previewCommission(v.salePriceCents, v.commissionRateBps).totalCents <= 0n) {
      ctx.addIssue({ code: "custom", path: ["salePriceCents"], message: "The commission rounds down to zero" });
    }
  }) satisfies z.ZodType<AdminCpcvInput>;

export type CpcvField = keyof AdminCpcvInput;

/** Field → first error message, from a failed safeParse. */
export function fieldErrors(error: z.ZodError): Partial<Record<CpcvField, string>> {
  const out: Partial<Record<CpcvField, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as CpcvField | undefined;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export interface DateIssue {
  path: "cpcvDate" | "escrituraDate";
  message: string;
}

/**
 * Checks that need the protocol clock (spec §5.7): the CPCV is already signed
 * (not after today's protocol date) and the escritura is still ahead
 * (`escritura_day > protocol_now / 86_400`, as cpcv_note.mint requires).
 */
export function protocolDateIssues(input: Pick<AdminCpcvInput, "cpcvDate" | "escrituraDate">, protocolDay: number): DateIssue[] {
  const issues: DateIssue[] = [];
  const today = formatDate(protocolDay);
  const cpcvDay = isoDateToDay(input.cpcvDate);
  const escrituraDay = isoDateToDay(input.escrituraDate);
  if (cpcvDay !== null && cpcvDay > protocolDay) {
    issues.push({ path: "cpcvDate", message: `The CPCV date can't be after today's protocol date (${today})` });
  }
  if (escrituraDay !== null && escrituraDay <= protocolDay) {
    issues.push({ path: "escrituraDate", message: `The escritura must be after today's protocol date (${today})` });
  }
  return issues;
}
