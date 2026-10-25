"use client";

import { CreditCard, Eye, EyeOff, Nfc } from "lucide-react";
import { useEffect, useState } from "react";

import { AdvancePill, LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CopyButton } from "@/components/ui/copy-button";
import type { CardRevealResponse } from "@/lib/types/api";

import { errorMessage } from "./api";
import { useAgentApp } from "./context";
import { cardNetworkLabel, cardState, type CardState, type Overview } from "./state";

/** Revealed details hide again after this long. */
const REVEAL_FOR_MS = 60_000;

const groupPan = (pan: string) =>
  pan
    .replace(/\s+/g, "")
    .replace(/(.{4})/g, "$1 ")
    .trim();

const STATE_PILL: Partial<Record<CardState, string>> = {
  inactive: "Not active yet",
  paused: "Paused",
};

/** The virtual card: blue gradient, explorador mark, last4, network label; PAN/expiry/CVV when revealed. */
export function CardVisual({
  last4,
  state,
  networkLabel,
  holder,
  details,
}: {
  last4: string;
  state: Exclude<CardState, "none">;
  networkLabel: string;
  holder: string;
  details: CardRevealResponse | null;
}) {
  const inactive = state !== "active";
  return (
    <div
      className={cn(
        "relative isolate aspect-[1.586/1] w-full overflow-hidden rounded-[1.25rem] p-5 text-white shadow-brand select-none sm:p-6",
        "bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 dark:from-blue-600 dark:via-blue-700 dark:to-slate-900",
      )}
      role="group"
      aria-label={`explorador advance virtual card ending in ${last4}${inactive ? `, ${STATE_PILL[state]?.toLowerCase()}` : ""}`}
    >
      <span aria-hidden className="pointer-events-none absolute -top-28 -right-24 size-72 rounded-full bg-white/10" />
      <span aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-sky-300/15" />
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgb(255_255_255/0.22),transparent_50%)]" />

      <div className={cn("relative flex h-full flex-col justify-between transition-opacity", inactive && "opacity-70")}>
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2">
            <LogoMark className="size-7" />
            <span className="text-[1.15rem] leading-none font-normal tracking-normal">explorador</span>
            <AdvancePill className="px-1.5 text-[10px] leading-4" />
          </span>
          <Nfc aria-hidden className="size-6 shrink-0 text-white/80" />
        </div>

        <div className="flex flex-col gap-3">
          <span aria-hidden className="h-7 w-10 rounded-md bg-gradient-to-br from-amber-100 via-amber-300 to-amber-500 shadow-inner ring-1 ring-black/10" />
          <p className="font-mono text-[1.05rem] tracking-[0.16em] whitespace-nowrap tabular-nums sm:text-xl" aria-label={details ? `Card number ${details.pan}` : `Card number ending in ${last4}`}>
            {details ? groupPan(details.pan) : `•••• •••• •••• ${last4}`}
          </p>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.2em] text-blue-100/85 uppercase">{networkLabel}</p>
            <p className="mt-0.5 truncate text-sm font-semibold tracking-wide uppercase">{holder}</p>
          </div>
          <div className="flex shrink-0 gap-4 text-right">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.2em] text-blue-100/85 uppercase">Expires</p>
              <p className="font-mono text-sm tabular-nums">{details ? `${details.expMonth.padStart(2, "0")}/${details.expYear.slice(-2)}` : "••/••"}</p>
            </div>
            {details && (
              <div>
                <p className="text-[10px] font-semibold tracking-[0.2em] text-blue-100/85 uppercase">CVV</p>
                <p className="font-mono text-sm tabular-nums">{details.cvv}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {inactive && (
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-950/55 px-3 py-1 text-xs font-semibold tracking-wide whitespace-nowrap text-white ring-1 ring-white/25 backdrop-blur-sm">
          {STATE_PILL[state]}
        </span>
      )}
    </div>
  );
}

/** Placeholder before the card exists (onboarding). */
function CardPlaceholder() {
  return (
    <div className="flex aspect-[1.586/1] w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed border-slate-300 bg-card-muted/70 p-6 text-center dark:border-slate-700">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-tint text-primary-text ring-1 ring-primary/15">
        <CreditCard aria-hidden className="size-6" />
      </span>
      <p className="text-sm font-semibold text-heading">Your virtual card</p>
      <p className="max-w-[16rem] text-xs leading-relaxed text-muted">Issued as soon as your passkey and account are set up.</p>
    </div>
  );
}

function holderName(o: Overview): string {
  return o.user.displayName?.trim() || o.user.email.split("@")[0];
}

/** Card visual plus "Reveal details" (sandbox PAN, CVV and expiry). */
export function CardPanel({ data }: { data: Overview }) {
  const { api } = useAgentApp();
  const state = cardState(data);
  const [details, setDetails] = useState<CardRevealResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!details) return;
    const timer = setTimeout(() => setDetails(null), REVEAL_FOR_MS);
    return () => clearTimeout(timer);
  }, [details]);

  if (state === "none" || !data.agent.cardLast4) return <CardPlaceholder />;

  const reveal = async () => {
    setLoading(true);
    setError(null);
    try {
      setDetails(await api.reveal());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <CardVisual last4={data.agent.cardLast4} state={state} networkLabel={cardNetworkLabel(data)} holder={holderName(data)} details={details} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="secondary"
          size="sm"
          loading={loading}
          icon={details ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          onClick={() => (details ? setDetails(null) : void reveal())}
          aria-pressed={details !== null}
        >
          {details ? "Hide details" : "Reveal details"}
        </Button>
        {details && <CopyButton value={details.pan} label="Copy card number" className="size-9 rounded-xl ring-1 ring-line" />}
        <span className="text-xs text-muted">{details ? "Test card details · hidden again in a minute" : "Sandbox test card · no real money"}</span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
