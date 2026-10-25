import { describe, expect, it } from "vitest";

import { creditLimitCents, splitCommission, totalCommissionCents } from "@/lib/units";

import { nif, SEED_AGENTS, SEED_DEALS, SEED_INVESTORS, SEED_SPENDS, SEED_TOTAL_DAYS, type DealKey } from "./seed-data";

const limitEur = (key: DealKey) => {
  const d = SEED_DEALS[key].deal;
  return Number(creditLimitCents(splitCommission(totalCommissionCents(d.salePriceCents, d.commissionRateBps)).agent)) / 100;
};
const sum = (list: { amountEur: number }[]) => Math.round(list.reduce((s, x) => s + x.amountEur, 0) * 100) / 100;

describe("seed data (spec §11.2)", () => {
  it("NIFs carry a valid mod-11 check digit", () => {
    for (const d of Object.values(SEED_DEALS)) {
      for (const value of [d.deal.buyerNif, d.deal.sellerNif]) {
        expect(value).toMatch(/^\d{9}$/);
        const digits = [...value].map(Number);
        const total = digits.slice(0, 8).reduce((acc, x, i) => acc + x * (9 - i), 0);
        const check = 11 - (total % 11);
        expect(digits[8]).toBe(check >= 10 ? 0 : check);
      }
    }
    expect(nif("21345678")).toHaveLength(9);
  });

  it("three agents on the demo domain, two investors depositing 40,000 and 25,000", () => {
    expect(SEED_AGENTS.map((a) => a.displayName)).toEqual(["Ana Costa", "Bruno Ferreira", "Carla Mendes"]);
    expect(SEED_AGENTS.every((a) => a.email.endsWith("@demo.explorador.pt"))).toBe(true);
    expect(SEED_INVESTORS.map((i) => i.amountEur)).toEqual([40_000, 25_000]);
  });

  it("five CPCVs in Lisboa, Porto, Braga, Cascais and Faro, €185k–€620k at 4–5%", () => {
    const deals = Object.values(SEED_DEALS);
    expect(deals).toHaveLength(5);
    for (const city of ["Lisboa", "Porto", "Braga", "Cascais", "Faro"]) expect(deals.some((d) => d.deal.propertyAddress.endsWith(city))).toBe(true);
    for (const d of deals) {
      expect(d.deal.salePriceCents).toBeGreaterThanOrEqual(18_500_000n);
      expect(d.deal.salePriceCents).toBeLessThanOrEqual(62_000_000n);
      expect(d.deal.commissionRateBps).toBeGreaterThanOrEqual(400);
      expect(d.deal.commissionRateBps).toBeLessThanOrEqual(500);
      expect(d.cpcvOn).toBeLessThan(d.mintOn + 1);
      expect(d.escrituraOn).toBeGreaterThan(d.mintOn);
    }
  });

  it("active notes end with their escrituras 30–90 protocol days ahead; the cancelled one is still in grace", () => {
    for (const key of ["A1", "B2"] as const) {
      const ahead = SEED_DEALS[key].escrituraOn - SEED_TOTAL_DAYS;
      expect(ahead).toBeGreaterThanOrEqual(30);
      expect(ahead).toBeLessThanOrEqual(90);
    }
    // B4 is cancelled on D90: grace deadline D270 > D120
    expect(90 + 180).toBeGreaterThan(SEED_TOTAL_DAYS);
    // settled notes are settled on their escritura day
    expect(SEED_DEALS.C3.escrituraOn).toBe(60);
    expect(SEED_DEALS.A5.escrituraOn).toBe(75);
  });

  it("Ana draws ~70% of A1 through four purchases; other lines stay within their limits", () => {
    const anaA1 = [...SEED_SPENDS.day0, ...SEED_SPENDS.day30a1].filter((s) => s.agent === "ana");
    expect(anaA1).toHaveLength(4);
    const used = sum(anaA1) / limitEur("A1");
    expect(used).toBeGreaterThan(0.65);
    expect(used).toBeLessThan(0.72); // ~70% once 90-120 days of interest are added
    expect(sum(SEED_SPENDS.day30a5.filter((s) => s.agent === "ana"))).toBeLessThan(limitEur("A5"));
    expect(sum([...SEED_SPENDS.day0, ...SEED_SPENDS.day30a5].filter((s) => s.agent === "carla"))).toBeLessThan(limitEur("C3"));
    expect(sum(SEED_SPENDS.day60)).toBeLessThan(limitEur("B4"));
    // B2 lightly used, with B4's carried debt (≈ €1,500 + interest) also counting against Bruno's credit
    expect(sum(SEED_SPENDS.day90) / limitEur("B2")).toBeLessThan(0.15);
    expect(sum(SEED_SPENDS.day90) + sum(SEED_SPENDS.day60) * 1.02).toBeLessThan(limitEur("B2"));
  });
});
