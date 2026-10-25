import { describe, expect, it } from "vitest";

import { STROOPS_PER_EUR } from "@/lib/units";

import { ILLUSTRATION, applyLoss, yieldScenario } from "./yield-math";

const eur = (n: number) => BigInt(n) * STROOPS_PER_EUR;

describe("yieldScenario (spec §5.6 yield illustration: senior €100,000, junior €10,000)", () => {
  const base = { seniorAssets: ILLUSTRATION.seniorAssets, juniorAssets: ILLUSTRATION.juniorAssets };

  it("debt €60,000 → net interest €6,480/yr, all to senior: 6.48%, junior 0%", () => {
    const s = yieldScenario({ ...base, debt: eur(60_000) });
    expect(s.grossInterest).toBe(eur(7_200));
    expect(s.fee).toBe(eur(720));
    expect(s.netInterest).toBe(eur(6_480));
    expect(s.toSenior).toBe(eur(6_480));
    expect(s.toJunior).toBe(0n);
    expect(s.seniorApy).toBeCloseTo(0.0648, 10);
    expect(s.juniorApy).toBe(0);
  });

  it("debt €90,000 → net interest €9,720/yr: senior capped at 8.00%, junior €1,720 = 17.2%", () => {
    const s = yieldScenario({ ...base, debt: eur(90_000) });
    expect(s.netInterest).toBe(eur(9_720));
    expect(s.toSenior).toBe(eur(8_000));
    expect(s.toJunior).toBe(eur(1_720));
    expect(s.seniorApy).toBeCloseTo(0.08, 10);
    expect(s.juniorApy).toBeCloseTo(0.172, 10);
  });

  it("uses the live params when given", () => {
    const s = yieldScenario({ ...base, debt: eur(60_000) }, { agentAprBps: 1000, protocolFeeBps: 0, seniorTargetBps: 800 });
    expect(s.netInterest).toBe(eur(6_000));
  });
});

describe("applyLoss (spec §5.6 loss illustration)", () => {
  it("a €2,000 write-off takes junior from €10,000 to €8,000 and leaves senior untouched", () => {
    expect(applyLoss(ILLUSTRATION.seniorAssets, ILLUSTRATION.juniorAssets, ILLUSTRATION.loss)).toEqual({
      seniorAssets: eur(100_000),
      juniorAssets: eur(8_000),
      seniorLoss: 0n,
      juniorLoss: eur(2_000),
    });
  });

  it("senior only loses what junior can't cover", () => {
    expect(applyLoss(eur(100_000), eur(10_000), eur(12_500))).toMatchObject({ juniorAssets: 0n, seniorAssets: eur(97_500), seniorLoss: eur(2_500) });
  });
});
