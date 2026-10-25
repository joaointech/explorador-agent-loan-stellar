import { describe, expect, it } from "vitest";

import type { AdminCpcvInput } from "@/lib/types/api";

import { previewCommission, previewSettlement } from "./commission";
import { adminCpcvInputSchema, dayToIsoDate, fieldErrors, isoDateToDay, protocolDateIssues } from "./cpcv-input";

const EUR = 10_000_000n; // stroops

const valid: AdminCpcvInput = {
  agentId: "agent-1",
  buyerName: "Maria Silva",
  buyerNif: "123456789",
  sellerName: "João Pereira",
  sellerNif: "987654321",
  propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
  salePriceCents: 30_000_000,
  commissionRateBps: 500,
  cpcvDate: "2026-10-25",
  escrituraDate: "2027-01-23",
};

const errorsOf = (input: unknown) => {
  const parsed = adminCpcvInputSchema.safeParse(input);
  return parsed.success ? {} : fieldErrors(parsed.error);
};

describe("commission preview (spec §5.6 worked example)", () => {
  it("€300,000 at 5% → total €15,000, agent €7,500, explorador €7,500, credit limit €3,750", () => {
    const p = previewCommission(30_000_000, 500);
    expect(p).toEqual({
      totalCents: 1_500_000n,
      agentCents: 750_000n,
      exploradorCents: 750_000n,
      total: 15_000n * EUR,
      agent: 7_500n * EUR,
      explorador: 7_500n * EUR,
      creditLimit: 3_750n * EUR,
    });
  });

  it("rounds the total down, gives the agent floor(total / 2) and explorador the odd cent", () => {
    // €185,000.01 × 4.5% = €8,325.00045 → 832,500 cents; €1,234.57 × 1% = 1,234.57 cents → 1,234.
    expect(previewCommission(18_500_001, 450).totalCents).toBe(832_500n);
    const odd = previewCommission(123_457, 100);
    expect(odd).toMatchObject({ totalCents: 1_234n, agentCents: 617n, exploradorCents: 617n });
    const oddSplit = previewCommission(123_500, 100); // 1,235 cents
    expect(oddSplit).toMatchObject({ totalCents: 1_235n, agentCents: 617n, exploradorCents: 618n });
    // Credit limit is computed in stroops like advance_pool.open_line: half a cent survives.
    expect(oddSplit.creditLimit).toBe(617n * 50_000n);
  });

  it("previews the settlement: debt repaid, carried debt, payout, junior deposit", () => {
    const base = { agentCommission: 7_500n * EUR, exploradorCommission: 7_500n * EUR };
    // Worked example: €3,088.77 of debt → €4,411.23 to the card balance, €7,500 to junior.
    expect(previewSettlement({ ...base, lineDebt: 30_887_700_000n, carriedDebt: 0n })).toEqual({
      debtRepaid: 30_887_700_000n,
      carriedRepaid: 0n,
      agentPayout: 44_112_300_000n,
      shortfall: 0n,
      juniorDeposit: 7_500n * EUR,
    });
    // Carried debt from a cancelled note is repaid next.
    expect(previewSettlement({ ...base, lineDebt: 1_000n * EUR, carriedDebt: 2_000n * EUR })).toMatchObject({
      carriedRepaid: 2_000n * EUR,
      agentPayout: 4_500n * EUR,
    });
    // Debt above the agent's half: the shortfall becomes carried debt, nothing is paid out.
    expect(previewSettlement({ ...base, lineDebt: 8_000n * EUR, carriedDebt: 500n * EUR })).toMatchObject({
      debtRepaid: 7_500n * EUR,
      carriedRepaid: 0n,
      agentPayout: 0n,
      shortfall: 500n * EUR,
    });
  });
});

describe("New CPCV input validation", () => {
  it("accepts a valid CPCV and trims text", () => {
    const parsed = adminCpcvInputSchema.parse({ ...valid, buyerName: "  Maria Silva  ", buyerNif: " 123456789 " });
    expect(parsed).toMatchObject({ buyerName: "Maria Silva", buyerNif: "123456789" });
  });

  it("requires 9-digit NIFs that differ", () => {
    expect(errorsOf({ ...valid, buyerNif: "12345678" })).toHaveProperty("buyerNif");
    expect(errorsOf({ ...valid, sellerNif: "12345678a" })).toHaveProperty("sellerNif");
    expect(errorsOf({ ...valid, sellerNif: "1234567890" })).toHaveProperty("sellerNif");
    expect(errorsOf({ ...valid, sellerNif: valid.buyerNif })).toEqual({ sellerNif: "Buyer and seller can't have the same NIF" });
  });

  it("bounds the commission rate to 100–1000 bps (1%–10%), whole bps", () => {
    expect(errorsOf({ ...valid, commissionRateBps: 99 })).toHaveProperty("commissionRateBps");
    expect(errorsOf({ ...valid, commissionRateBps: 1001 })).toHaveProperty("commissionRateBps");
    expect(errorsOf({ ...valid, commissionRateBps: 450.5 })).toHaveProperty("commissionRateBps");
    expect(errorsOf({ ...valid, commissionRateBps: 100 })).toEqual({});
    expect(errorsOf({ ...valid, commissionRateBps: 1000 })).toEqual({});
  });

  it("asks for an empty sale price or rate in plain words (the form sends NaN), not zod's type error", () => {
    expect(errorsOf({ ...valid, salePriceCents: NaN, commissionRateBps: NaN })).toEqual({
      salePriceCents: "Enter the sale price",
      commissionRateBps: "Enter the commission rate",
    });
    expect(errorsOf({ ...valid, salePriceCents: undefined })).toEqual({ salePriceCents: "Enter the sale price" });
  });

  it("requires a positive whole-cent sale price whose commission is not zero", () => {
    expect(errorsOf({ ...valid, salePriceCents: 0 })).toHaveProperty("salePriceCents");
    expect(errorsOf({ ...valid, salePriceCents: 100.5 })).toHaveProperty("salePriceCents");
    expect(errorsOf({ ...valid, salePriceCents: 10_000_000_001 })).toHaveProperty("salePriceCents");
    expect(errorsOf({ ...valid, salePriceCents: 99, commissionRateBps: 100 })).toEqual({ salePriceCents: "The commission rounds down to zero" });
  });

  it("requires real YYYY-MM-DD dates with the escritura after the CPCV", () => {
    expect(errorsOf({ ...valid, cpcvDate: "25/10/2026" })).toHaveProperty("cpcvDate");
    expect(errorsOf({ ...valid, escrituraDate: "2027-02-30" })).toHaveProperty("escrituraDate");
    expect(errorsOf({ ...valid, escrituraDate: valid.cpcvDate })).toEqual({ escrituraDate: "The escritura must be after the CPCV" });
    expect(errorsOf({ ...valid, escrituraDate: "2026-10-01" })).toHaveProperty("escrituraDate");
  });

  it("requires names, an address that fits property_hash, and an agent", () => {
    expect(errorsOf({ ...valid, agentId: " " })).toHaveProperty("agentId");
    expect(errorsOf({ ...valid, buyerName: "" })).toHaveProperty("buyerName");
    expect(errorsOf({ ...valid, propertyAddress: "Rua" })).toHaveProperty("propertyAddress");
    // 200 characters but 400 UTF-8 bytes once normalized: too long for 8 × 31 bytes.
    expect(errorsOf({ ...valid, propertyAddress: "ã".repeat(200) })).toHaveProperty("propertyAddress");
    expect(adminCpcvInputSchema.safeParse({ ...valid, salePriceCents: "30000000" }).success).toBe(false);
  });
});

describe("protocol date checks", () => {
  const today = isoDateToDay("2026-10-25")!;

  it("converts between ISO dates and day numbers (UTC)", () => {
    expect(isoDateToDay("1970-01-02")).toBeNull(); // before 2000: rejected
    expect(isoDateToDay("2027-01-14")).toBe(20_832);
    expect(dayToIsoDate(20_832)).toBe("2027-01-14");
    expect(isoDateToDay("2027-13-01")).toBeNull();
  });

  it("needs the escritura after today's protocol date and the CPCV not after it", () => {
    expect(protocolDateIssues(valid, today)).toEqual([]);
    expect(protocolDateIssues({ ...valid, escrituraDate: "2026-10-25" }, today)).toEqual([
      { path: "escrituraDate", message: "The escritura must be after today's protocol date (25 Oct 2026)" },
    ]);
    expect(protocolDateIssues({ ...valid, cpcvDate: "2026-10-26", escrituraDate: "2027-01-01" }, today)).toEqual([
      { path: "cpcvDate", message: "The CPCV date can't be after today's protocol date (25 Oct 2026)" },
    ]);
    // A fast-forwarded clock (+90 days) moves "today" with it.
    expect(protocolDateIssues(valid, today + 90)).toEqual([
      { path: "escrituraDate", message: "The escritura must be after today's protocol date (23 Jan 2027)" },
    ]);
  });
});
