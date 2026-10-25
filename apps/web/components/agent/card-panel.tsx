"use client";
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import type { AgentOverviewResponse, CardRevealResponse } from "@/lib/api-types";
import { CardVisual } from "@/components/card-visual";
import { Button } from "@/components/ui/button";
import { apiGet, errorMessage } from "@/lib/client/api";

export function CardPanel({ data }: { data: AgentOverviewResponse }) {
  const [revealed, setRevealed] = React.useState<CardRevealResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const holder = data.user.displayName ?? data.user.email.split("@")[0];

  async function toggle() {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setRevealed(await apiGet<CardRevealResponse>("/api/agent/card/reveal"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <CardVisual
        last4={data.card?.last4 ?? null}
        holder={holder}
        pan={revealed?.pan}
        cvv={revealed?.cvv}
        exp={revealed ? `${revealed.expMonth.padStart(2, "0")}/${revealed.expYear.slice(-2)}` : null}
      />
      <div className="flex w-full max-w-[380px] items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {data.onboarding.cardActivated ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" /> Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500" /> Not activated
            </span>
          )}
        </span>
        <Button variant="ghost" size="sm" onClick={toggle} loading={busy} disabled={!data.card}>
          {revealed ? <EyeOff /> : <Eye />} {revealed ? "Hide details" : "Reveal details"}
        </Button>
      </div>
      {error && <p className="w-full max-w-[380px] text-center text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
