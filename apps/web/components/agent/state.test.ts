// View-model helpers against the mocked overviews.

import { describe, expect, it } from "vitest";

import { formatEur } from "@/lib/format";

import { AGENT_FIXTURES, isAgentFixtureName } from "./fixtures";
import { cardNetworkLabel, cardState, declineLabel, declineMessage, firstName, onboardingState, spendable, withdrawable } from "./state";

const F = AGENT_FIXTURES;

describe("onboardingState", () => {
  it("walks email → passkey → card created → activate card", () => {
    const steps = (name: keyof typeof F) => onboardingState(F[name]).steps.map((s) => `${s.id}:${s.status}`);
    expect(steps("newAgent")).toEqual(["email:done", "passkey:active", "card:idle", "activate:idle"]);
    expect(steps("provisioningFailed")).toEqual(["email:done", "passkey:done", "card:active", "activate:idle"]);
    expect(steps("awaitingActivation")).toEqual(["email:done", "passkey:done", "card:done", "activate:active"]);
    expect(onboardingState(F.newAgent)).toMatchObject({ complete: false, current: "passkey", provisioningIncomplete: false });
    expect(onboardingState(F.provisioningFailed)).toMatchObject({ current: "card", provisioningIncomplete: true });
    expect(onboardingState(F.activeWithDeals)).toMatchObject({ complete: true, current: null, provisioningIncomplete: false });
  });

  it("seed agents (demo signer) skip the passkey step", () => {
    const state = onboardingState(F.seedAgent);
    expect(state.current).toBe("activate");
    expect(state.steps[1]).toEqual({ id: "passkey", label: "Passkey", status: "done", skipped: true });
  });

  it("a paused card stays onboarded", () => {
    expect(onboardingState(F.pausedCard).complete).toBe(true);
    expect(cardState(F.pausedCard)).toBe("paused");
  });
});

describe("money", () => {
  it("spendable = card balance + borrowable now − pending holds", () => {
    // €406.43 + €3,524.82 − €62.00 on hold
    expect(formatEur(spendable(F.activeWithDeals))).toBe("€3,869.25");
    expect(formatEur(withdrawable(F.activeWithDeals))).toBe("€344.43");
    expect(formatEur(spendable(F.carriedDebt))).toBe("€1,784.77");
    expect(spendable(F.newAgent)).toBe(0n);
    expect(spendable({ ...F.activeWithDeals, pendingHolds: String(10n ** 15n) })).toBe(0n);
  });
});

describe("labels", () => {
  it("card state and network", () => {
    expect(cardState(F.newAgent)).toBe("none");
    expect(cardState(F.awaitingActivation)).toBe("inactive");
    expect(cardState(F.activeWithDeals)).toBe("active");
    expect(cardNetworkLabel(F.activeWithDeals)).toBe("Virtual · Simulated");
    expect(cardNetworkLabel({ ...F.activeWithDeals, agent: { ...F.activeWithDeals.agent, cardNetwork: "lithic" } })).toBe("Virtual · Sandbox");
  });

  it("greeting and decline reasons", () => {
    expect(firstName(F.activeWithDeals)).toBe("Inês");
    expect(firstName(F.newAgent)).toBeNull();
    expect(declineLabel("INSUFFICIENT_FUNDS")).toBe("Insufficient funds");
    expect(declineLabel("UNAUTHORIZED_MERCHANT")).toBe("Unauthorized merchant");
    expect(declineLabel(null)).toBe("Declined");
    expect(declineMessage("INSUFFICIENT_FUNDS", 120n * 10_000_000n)).toBe("Insufficient funds: you can spend €120.00 right now.");
    expect(declineMessage("CARD_PAUSED", 0n)).toMatch(/isn't active on-chain/);
  });

  it("fixture names are validated for ?state=", () => {
    expect(isAgentFixtureName("carriedDebt")).toBe(true);
    expect(isAgentFixtureName("toString")).toBe(false);
    expect(isAgentFixtureName(undefined)).toBe(false);
  });
});
