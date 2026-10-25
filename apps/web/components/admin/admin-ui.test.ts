import { describe, expect, it } from "vitest";

import { jsonify } from "@/lib/json";
import type { PipelineEvent } from "@/lib/types/api";
import type { PoolStats } from "@/lib/types/chain";

import { demoDeal, randomNif } from "./demo-data";
import { applyPipelineEvent, currentStep, idlePipeline } from "./pipeline-steps";
import { claimableFees, floorToCent, maxJuniorWithdraw } from "./treasury-cards";

const EUR = 10_000_000n;

describe("pipeline stepper state", () => {
  const run = (events: PipelineEvent[]) => events.reduce((s, e, i) => applyPipelineEvent(s, e, i * 100), idlePipeline());

  it("walks the steps from the SSE events and marks everything done at the end", () => {
    let state = run([
      { step: "validating", status: "started" },
      { step: "validating", status: "completed" },
      { step: "signing", status: "started", message: "Signing" },
    ]);
    expect(state.validating).toMatchObject({ status: "done", startedAt: 0, endedAt: 100 });
    expect(state.signing).toMatchObject({ status: "active", message: "Signing" });
    expect(state.proving.status).toBe("idle");
    expect(currentStep(state)).toBe("signing");

    state = applyPipelineEvent(state, { step: "done", status: "completed", message: "Note #7 is live" }, 900);
    expect(Object.values(state).every((s) => s.status === "done")).toBe(true);
    expect(currentStep(state)).toBe("done");
  });

  it("shows a failure on the step that failed", () => {
    const state = run([
      { step: "validating", status: "started" },
      { step: "validating", status: "completed" },
      { step: "signing", status: "started" },
      { step: "signing", status: "completed" },
      { step: "proving", status: "started" },
      { step: "proving", status: "failed", message: "Proof generation failed: boom" },
    ]);
    expect(state.proving).toMatchObject({ status: "error", message: "Proof generation failed: boom" });
    expect(currentStep(state)).toBe("proving");
    expect(state.minting.status).toBe("idle");
  });
});

describe("treasury limits", () => {
  const stats = (over: Partial<PoolStats>) =>
    jsonify<PoolStats>({
      seniorAssets: 65_000n * EUR,
      juniorAssets: 10_000n * EUR,
      feesAccrued: 12n * EUR,
      totalDebt: 3_000n * EUR,
      totalPrincipal: 3_000n * EUR,
      poolCash: 72_012n * EUR,
      totalCardBalances: 0n,
      shareSupply: 65_000n * EUR,
      sharePriceScaled: 10n ** 18n,
      utilizationBps: 400,
      leverageX100: 30,
      lendable: 72_000n * EUR,
      leverageHeadroom: 97_000n * EUR,
      borrowIndex: 10n ** 18n,
      protocolNow: 1_800_000_000n,
      params: { agentAprBps: 1200, protocolFeeBps: 1000, seniorTargetBps: 800, ltvBps: 5000, gracePeriodSecs: 15_552_000n, maxLeverage: 10, demoMode: true },
      writtenOffTotal: 0n,
      ...over,
    });

  it("junior withdrawals keep debt ≤ 10 × junior and stay within idle liquidity", () => {
    // €3,000 of debt needs €300 of junior: €9,700 can leave.
    expect(maxJuniorWithdraw(stats({}))).toBe(9_700n * EUR);
    // Little idle cash: liquidity binds.
    expect(maxJuniorWithdraw(stats({ lendable: 500n * EUR }))).toBe(500n * EUR);
    // Debt already at the cap: nothing can leave.
    expect(maxJuniorWithdraw(stats({ totalDebt: 100_001n * EUR }))).toBe(0n);
    // Rounds the junior that must stay up, so the contract never rejects the max.
    expect(maxJuniorWithdraw(stats({ totalDebt: 3_000n * EUR + 1n }))).toBe(9_700n * EUR - 1n);
  });

  it("fee claims are bounded by fees accrued and pool cash", () => {
    expect(claimableFees(stats({}))).toBe(12n * EUR);
    expect(claimableFees(stats({ poolCash: 5n * EUR }))).toBe(5n * EUR);
  });

  it("limits are shown rounded down to the cent, like Max fills them in", () => {
    // €57.2380724 of fees: the form can send at most €57.23, so it must not say €57.24.
    expect(floorToCent(572_380_724n)).toBe(572_300_000n);
    expect(floorToCent(572_300_000n)).toBe(572_300_000n);
    expect(floorToCent(99_999n)).toBe(0n);
  });
});

describe("demo data", () => {
  const checkDigit = (nif: string) => {
    const sum = [...nif.slice(0, 8)].reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  it("generates valid personal NIFs", () => {
    for (let i = 0; i < 200; i++) {
      const nif = randomNif();
      expect(nif).toMatch(/^[123]\d{8}$/);
      expect(Number(nif[8])).toBe(checkDigit(nif));
    }
  });

  it("starts with the worked example and never reuses the same parties", () => {
    const first = demoDeal(0);
    expect(first).toMatchObject({ salePrice: "300000", ratePct: "5", propertyAddress: expect.stringContaining("Lisboa") });
    expect(first.buyerNif).not.toBe(first.sellerNif);
    expect(demoDeal(0).buyerNif === first.buyerNif && demoDeal(0).sellerNif === first.sellerNif).toBe(false);
    expect(demoDeal(1).propertyAddress).toContain("Porto");
  });
});
