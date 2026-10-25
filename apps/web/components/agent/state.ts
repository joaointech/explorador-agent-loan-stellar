// View-model helpers for the agent app: onboarding steps, spendable amount,
// card state and human labels. Pure functions (no React, no I/O), unit-tested.

import { formatEur } from "@/lib/format";
import type { AgentOverviewResponse } from "@/lib/types/api";

export type Overview = AgentOverviewResponse;

// ---------- onboarding (spec §4.2, §10.2) ----------

export type OnboardingStepId = "email" | "passkey" | "card" | "activate";

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  status: "done" | "active" | "idle";
  /** Seed agents skip the passkey: their account is signed by a server-held demo key. */
  skipped?: boolean;
}

export interface OnboardingState {
  complete: boolean;
  /** First step that isn't done. */
  current: OnboardingStepId | null;
  steps: OnboardingStep[];
  /** Passkey saved but the smart account or the card is missing: offer "Try again". */
  provisioningIncomplete: boolean;
}

const STEP_LABELS: Record<OnboardingStepId, string> = {
  email: "Email",
  passkey: "Passkey",
  card: "Card created",
  activate: "Activate card",
};

/** email (done by signing in) → passkey (deploys the smart account and issues the card) → card created → activate card. */
export function onboardingState(o: Overview): OnboardingState {
  const demo = o.agent.signerKind === "demo-ed25519";
  const done: Record<OnboardingStepId, boolean> = {
    email: true,
    passkey: o.onboarding.passkey || demo,
    card: o.onboarding.smartAccount && o.onboarding.card,
    activate: o.onboarding.cardActivated,
  };
  const order: OnboardingStepId[] = ["email", "passkey", "card", "activate"];
  const current = order.find((id) => !done[id]) ?? null;
  return {
    complete: current === null,
    current,
    steps: order.map((id) => ({
      id,
      label: STEP_LABELS[id],
      status: done[id] ? "done" : id === current ? "active" : "idle",
      ...(id === "passkey" && demo && !o.onboarding.passkey ? { skipped: true } : {}),
    })),
    provisioningIncomplete: done.passkey && !done.card,
  };
}

// ---------- money ----------

const big = (v: string | null | undefined): bigint => (v ? BigInt(v) : 0n);

/** Card balance + borrowable now − purchases approved but not yet drawn on-chain (spec §4.4), never negative. */
export function spendable(o: Overview): bigint {
  if (!o.position) return 0n;
  const v = big(o.position.cardBalance) + big(o.position.borrowableNow) - big(o.pendingHolds);
  return v > 0n ? v : 0n;
}

/** Card balance the agent can withdraw now: pending purchases are drawn from it first. */
export function withdrawable(o: Overview): bigint {
  if (!o.position) return 0n;
  const v = big(o.position.cardBalance) - big(o.pendingHolds);
  return v > 0n ? v : 0n;
}

// ---------- card ----------

export type CardState = "none" | "inactive" | "active" | "paused";

export function cardState(o: Overview): CardState {
  if (!o.onboarding.card || !o.agent.cardLast4) return "none";
  if (o.agent.cardEnabledOnChain) return "active";
  return o.agent.cardPaused ? "paused" : "inactive";
}

export const cardNetworkLabel = (o: Overview): string => (o.agent.cardNetwork === "simulated" ? "Virtual · Simulated" : "Virtual · Sandbox");

// ---------- labels ----------

/** First name for the greeting, or null. */
export function firstName(o: Overview): string | null {
  const name = o.user.displayName?.trim();
  return name ? name.split(/\s+/)[0] : null;
}

const DECLINE_REASONS: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Insufficient funds",
  CARD_PAUSED: "Your card isn't active",
  SUSPECTED_FRAUD: "Card not recognised",
  ACCOUNT_INACTIVE: "Card not active",
  CARD_CLOSED: "Card closed",
};

/** Short label for a decline reason (ASA results, or Lithic's own decline result). */
export function declineLabel(reason: string | null): string {
  if (!reason) return "Declined";
  if (DECLINE_REASONS[reason]) return DECLINE_REASONS[reason];
  const words = reason.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One sentence explaining a decline, with what the agent can spend when that's the reason. */
export function declineMessage(reason: string | null, spendableNow: bigint): string {
  if (reason === "INSUFFICIENT_FUNDS") return `Insufficient funds: you can spend ${formatEur(spendableNow)} right now.`;
  if (reason === "CARD_PAUSED") return "Your card isn't active on-chain. Activate it, then try again.";
  return `${declineLabel(reason)}.`;
}
