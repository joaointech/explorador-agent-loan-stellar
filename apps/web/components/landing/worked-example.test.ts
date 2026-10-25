import { describe, expect, it } from "vitest";

import { formatEur } from "@/lib/format";

import { DEAL, LOSS, POOL, YIELD_HIGH, YIELD_LOW, eur, juniorPct, ratePct, seniorPct } from "./worked-example";

// Every figure the landing page shows, pinned to the exact numbers of spec §5.6.
describe("worked example (spec §5.6)", () => {
  it("splits a €300,000 sale at 5%", () => {
    expect(eur(DEAL.salePrice)).toBe("€300,000");
    expect(ratePct(DEAL.rateBps)).toBe("5%");
    expect(formatEur(DEAL.totalCommission)).toBe("€15,000.00");
    expect(formatEur(DEAL.agentCommission)).toBe("€7,500.00");
    expect(formatEur(DEAL.exploradorCommission)).toBe("€7,500.00");
    expect(formatEur(DEAL.creditLimit)).toBe("€3,750.00");
  });

  it("charges €88.77 on €3,000 over 90 days (single accrual) and pays €4,411.23 out", () => {
    expect(formatEur(DEAL.spent)).toBe("€3,000.00");
    expect(DEAL.days).toBe(90);
    expect(formatEur(DEAL.interest)).toBe("€88.77");
    expect(formatEur(DEAL.protocolFee)).toBe("€8.88");
    expect(formatEur(DEAL.toTranches)).toBe("€79.89");
    expect(formatEur(DEAL.debtRepaid)).toBe("€3,088.77");
    expect(formatEur(DEAL.agentPayout)).toBe("€4,411.23");
    expect(formatEur(DEAL.juniorDeposit)).toBe("€7,500.00");
    // The commission covers exactly: debt + payout + junior deposit.
    expect(DEAL.debtRepaid + DEAL.agentPayout + DEAL.juniorDeposit).toBe(DEAL.totalCommission);
  });

  it("projects 6.48% senior at €60,000 of debt and 8.00% + 17.2% at €90,000", () => {
    expect(eur(POOL.senior)).toBe("€100,000");
    expect(eur(POOL.junior)).toBe("€10,000");
    expect(eur(YIELD_LOW.debt)).toBe("€60,000");
    expect(eur(YIELD_LOW.netInterestPerYear)).toBe("€6,480");
    expect(seniorPct(YIELD_LOW.seniorApy)).toBe("6.48%");
    expect(juniorPct(YIELD_LOW.juniorApy)).toBe("0%");
    expect(eur(YIELD_HIGH.debt)).toBe("€90,000");
    expect(eur(YIELD_HIGH.netInterestPerYear)).toBe("€9,720");
    expect(seniorPct(YIELD_HIGH.seniorApy)).toBe("8.00%");
    expect(juniorPct(YIELD_HIGH.juniorApy)).toBe("17.2%");
  });

  it("writes €2,000 off against the first-loss tranche only", () => {
    expect(eur(LOSS.loss)).toBe("€2,000");
    expect(eur(LOSS.juniorBefore)).toBe("€10,000");
    expect(eur(LOSS.juniorAfter)).toBe("€8,000");
    expect(LOSS.seniorAfter).toBe(LOSS.seniorBefore);
  });
});
