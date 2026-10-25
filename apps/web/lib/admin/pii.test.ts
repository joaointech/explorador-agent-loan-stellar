import { describe, expect, it } from "vitest";

import { encryptJson } from "@/lib/crypto";

import { decryptCpcvPii, encryptCpcvPii, type CpcvPii } from "./pii";

const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(8);

const pii: CpcvPii = {
  v: 1,
  buyerName: "Maria Silva",
  buyerNif: "123456789",
  sellerName: "João Pereira",
  sellerNif: "987654321",
  propertyAddress: "Rua de Santa Catarina 200, 4000-447 Porto",
  salePriceCents: 41_500_000,
  commissionRateBps: 450,
  cpcvDate: "2026-10-20",
  cpcvDay: 20_746,
  salt: "ab".repeat(32),
};

describe("CPCV PII record", () => {
  it("round-trips through AES-256-GCM without leaking plaintext", () => {
    const blob = encryptCpcvPii(pii, KEY);
    expect(Buffer.from(blob).toString("utf8")).not.toContain("Maria");
    expect(decryptCpcvPii(blob, KEY)).toEqual(pii);
    expect(() => decryptCpcvPii(blob, OTHER_KEY)).toThrow(/authentication failed/);
  });

  it("reads records written by other tools leniently (string numbers, no cpcvDay, no salt)", () => {
    const blob = encryptJson(
      { buyerName: "Ana", buyerNif: 123456789, sellerName: "Rui", sellerNif: "987654321", propertyAddress: "Rua X 1, Faro", salePriceCents: "18500000", commissionRateBps: "400", cpcvDate: "2026-10-20" },
      KEY,
    );
    expect(decryptCpcvPii(blob, KEY)).toEqual({
      v: 1,
      buyerName: "Ana",
      buyerNif: "123456789",
      sellerName: "Rui",
      sellerNif: "987654321",
      propertyAddress: "Rua X 1, Faro",
      salePriceCents: 18_500_000,
      commissionRateBps: 400,
      cpcvDate: "2026-10-20",
      cpcvDay: 20_746,
      salt: null,
    });
    expect(() => decryptCpcvPii(encryptJson(["not", "a", "record"], KEY), KEY)).toThrow(/does not hold a CPCV record/);
  });
});
