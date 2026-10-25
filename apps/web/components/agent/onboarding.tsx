"use client";
import * as React from "react";
import { Check, CreditCard, Fingerprint, Mail, Power } from "lucide-react";
import type { AgentOverviewResponse } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorNote } from "@/components/common";
import { errorMessage } from "@/lib/client/api";
import { registerPasskey, runAgentAction } from "@/lib/client/passkey";
import { cn } from "@/lib/utils";

export function OnboardingStepper({ data, onChanged }: { data: AgentOverviewResponse; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = React.useState<null | "passkey" | "activate">(null);
  const [error, setError] = React.useState<string | null>(null);
  const passkeyDone = data.onboarding.passkey || data.signerKind === "demo-ed25519";
  const steps = [
    { key: "email", label: "Email verified", icon: Mail, done: true },
    { key: "passkey", label: data.signerKind === "demo-ed25519" ? "Demo signer" : "Passkey created", icon: Fingerprint, done: passkeyDone },
    { key: "card", label: "Card created", icon: CreditCard, done: data.onboarding.card },
    { key: "activate", label: "Card activated", icon: Power, done: data.onboarding.cardActivated },
  ];
  const current = steps.findIndex((s) => !s.done);

  async function activate() {
    setBusy("activate");
    setError(null);
    try {
      await runAgentAction("enable_card");
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function createPasskey() {
    setBusy("passkey");
    setError(null);
    try {
      await registerPasskey();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <p className="eyebrow">Get started</p>
      <h2 className="mt-1 text-xl font-bold">Set up your explorador card</h2>
      <ol className="mt-5 grid grid-cols-4 gap-2">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-col items-center gap-2 text-center">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full ring-1",
                s.done
                  ? "bg-emerald-500 text-white ring-emerald-500"
                  : i === current
                    ? "bg-primary text-white ring-primary"
                    : "bg-surface text-muted ring-line",
              )}
            >
              {s.done ? <Check className="size-5" /> : <s.icon className="size-5" />}
            </span>
            <span className={cn("text-[11px] font-semibold leading-tight sm:text-xs", s.done || i === current ? "text-ink" : "text-muted")}>{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5">
        {!passkeyDone ? (
          <Button className="w-full" onClick={createPasskey} loading={busy === "passkey"}>
            <Fingerprint /> Create passkey →
          </Button>
        ) : !data.onboarding.card ? (
          <p className="rounded-xl bg-primary-faint px-4 py-3 text-sm text-ink-soft">Your virtual card is being created. This page updates automatically.</p>
        ) : !data.onboarding.cardActivated ? (
          <div className="flex flex-col gap-2">
            <Button className="w-full" size="lg" onClick={activate} loading={busy === "activate"}>
              <Power /> Activate card →
            </Button>
            <p className="text-center text-xs text-muted">
              One passkey prompt. It authorises explorador to fund your card purchases from your balance and credit — nothing else.
            </p>
          </div>
        ) : null}
        {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      </div>
    </Card>
  );
}
