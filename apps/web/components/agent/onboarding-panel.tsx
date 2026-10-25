"use client";

import { Check, CircleDashed, CreditCard, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Stepper } from "@/components/ui/stepper";
import { Eyebrow } from "@/components/ui/typography";

import { AgentAction, CreatePasskeyAction, RetrySetupAction } from "./actions";
import { onboardingState, type OnboardingStepId, type Overview } from "./state";

const TITLES: Record<OnboardingStepId, string> = {
  email: "Set up your card",
  passkey: "Set up your card in a minute",
  card: "Almost there",
  activate: "One last step",
};

function StepIntro({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-tint text-primary-text ring-1 ring-primary/15 [&_svg]:size-5">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-base font-bold text-heading">{title}</h3>
        <div className="mt-1 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}

function Check1({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          done ? "bg-primary text-white" : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
        )}
      >
        {done ? <Check aria-hidden className="size-3.5" strokeWidth={2.25} /> : <CircleDashed aria-hidden className="size-3.5" />}
      </span>
      <span className={done ? "text-heading" : "text-muted"}>
        {children}
        <span className="sr-only">{done ? ", done" : ", not done yet"}</span>
      </span>
    </li>
  );
}

/** Onboarding stepper (spec §4.2): email → passkey → card created → activate card, with the current step's action. */
export function OnboardingPanel({ data }: { data: Overview }) {
  const state = onboardingState(data);
  if (state.complete || !state.current) return null;
  const demo = data.agent.signerKind === "demo-ed25519";

  let body: ReactNode;
  if (state.current === "passkey") {
    body = (
      <>
        <StepIntro icon={<KeyRound />} title="Create your passkey">
          Your passkey (Face ID, Touch ID, Windows Hello or your phone&apos;s screen lock) signs you in and controls your explorador account on Stellar. No wallet,
          no seed phrase, no fees.
        </StepIntro>
        <ul className="mt-4 flex flex-col gap-2 rounded-card bg-card-muted p-4 ring-1 ring-line">
          <Check1 done={false}>We deploy your smart account on Stellar (explorador pays the fee)</Check1>
          <Check1 done={false}>We issue your virtual card</Check1>
        </ul>
        <div className="mt-5">
          <CreatePasskeyAction icon={<KeyRound aria-hidden className="size-4" />}>Create passkey →</CreatePasskeyAction>
        </div>
      </>
    );
  } else if (state.current === "card") {
    body = (
      <>
        <StepIntro icon={<Wallet />} title="Finishing your account">
          Your passkey is saved, but setting up your account didn&apos;t finish. It&apos;s safe to try again: nothing is created twice.
        </StepIntro>
        <ul className="mt-4 flex flex-col gap-2 rounded-card bg-card-muted p-4 ring-1 ring-line">
          <Check1 done={state.steps[1].status === "done"}>Passkey saved</Check1>
          <Check1 done={data.onboarding.smartAccount}>Smart account on Stellar</Check1>
          <Check1 done={data.onboarding.card}>Virtual card issued</Check1>
        </ul>
        <div className="mt-5">{demo ? <p className="text-sm text-muted">Seed accounts are set up by the demo seed script.</p> : <RetrySetupAction>Try again</RetrySetupAction>}</div>
      </>
    );
  } else {
    body = (
      <>
        <StepIntro icon={<ShieldCheck />} title="Activate your card">
          {demo ? (
            <>This seed account is signed by a server-held demo key, so activation needs no passkey prompt.</>
          ) : (
            <>One passkey prompt records your on-chain consent: explorador may draw on your credit line, only when you pay with this card.</>
          )}{" "}
          You can pause it any time in Settings.
        </StepIntro>
        <div className="mt-5">
          <AgentAction action={{ action: "enable_card" }} icon={<CreditCard aria-hidden className="size-4" />}>
            Activate card
          </AgentAction>
        </div>
      </>
    );
  }

  return (
    <Card radius="3xl" padding="md" className="ring-1 ring-primary/10">
      <Eyebrow tone="primary">Get started</Eyebrow>
      <h2 className="mt-1.5 text-xl font-bold tracking-tight text-heading">{TITLES[state.current]}</h2>
      <Stepper
        className="mt-5"
        orientation="horizontal"
        label="Onboarding"
        steps={state.steps.map((s) => ({ id: s.id, label: s.skipped ? `${s.label} (skipped)` : s.label, status: s.status }))}
      />
      <div className="mt-5 border-t border-line pt-5">{body}</div>
    </Card>
  );
}
