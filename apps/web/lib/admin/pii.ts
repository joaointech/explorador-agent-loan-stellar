// The private CPCV record (spec §8.1 "hidden", §9.1 Cpcv.piiEncrypted):
// buyer and seller names and NIFs, property address, sale price, commission
// rate, CPCV date and the commitment salt. AES-256-GCM JSON via lib/crypto;
// only decrypted for admins. Server-side (Node crypto); no `server-only` so
// the seed script can write rows in the same format.
//
// Format (version 1), JSON:
//   { v: 1, buyerName, buyerNif, sellerName, sellerNif, propertyAddress,
//     salePriceCents: number, commissionRateBps: number,
//     cpcvDate: "YYYY-MM-DD", cpcvDay: number, salt: "<64 hex>" | null }
// `salt` is null until the proof exists. Decoding is lenient (numbers may be
// decimal strings, cpcvDay may be derived from cpcvDate) so rows written by
// other tools still open.

import { z } from "zod";

import { decryptJson, encryptJson } from "@/lib/crypto";

import { dayToIsoDate, isoDateToDay } from "./cpcv-input";

export interface CpcvPii {
  v: 1;
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  salePriceCents: number;
  commissionRateBps: number;
  cpcvDate: string;
  cpcvDay: number;
  /** Commitment salt (hex), so explorador can open the commitment for an auditor (spec §8.1). */
  salt: string | null;
}

const intish = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);

const piiSchema = z
  .looseObject({
    buyerName: z.string().default(""),
    buyerNif: z.union([z.string(), z.number()]).transform(String).default(""),
    sellerName: z.string().default(""),
    sellerNif: z.union([z.string(), z.number()]).transform(String).default(""),
    propertyAddress: z.string().default(""),
    salePriceCents: intish.default(0),
    commissionRateBps: intish.default(0),
    cpcvDate: z.string().optional(),
    cpcvDay: intish.optional(),
    salt: z.string().nullish(),
  })
  .transform((p): CpcvPii => {
    const cpcvDay = p.cpcvDay ?? (p.cpcvDate ? isoDateToDay(p.cpcvDate) : null) ?? 0;
    return {
      v: 1,
      buyerName: p.buyerName,
      buyerNif: p.buyerNif,
      sellerName: p.sellerName,
      sellerNif: p.sellerNif,
      propertyAddress: p.propertyAddress,
      salePriceCents: p.salePriceCents,
      commissionRateBps: p.commissionRateBps,
      cpcvDate: p.cpcvDate ?? dayToIsoDate(cpcvDay),
      cpcvDay,
      salt: p.salt ?? null,
    };
  });

/** Encrypts the record for `Cpcv.piiEncrypted` (PII_ENCRYPTION_KEY unless a key is given). */
export function encryptCpcvPii(pii: CpcvPii, key?: Uint8Array): Uint8Array<ArrayBuffer> {
  return key ? encryptJson(pii, key) : encryptJson(pii);
}

/** Decrypts and normalizes `Cpcv.piiEncrypted`. Throws on a wrong key, tampering or a non-object payload. */
export function decryptCpcvPii(blob: Uint8Array, key?: Uint8Array): CpcvPii {
  const raw = key ? decryptJson(blob, key) : decryptJson(blob);
  const parsed = piiSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Cpcv.piiEncrypted does not hold a CPCV record");
  return parsed.data;
}
