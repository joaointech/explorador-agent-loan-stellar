"use client";

import { Ban, CirclePause, CloudOff, Hourglass } from "lucide-react";
import type { ReactNode } from "react";

import { Amount } from "@/components/ui/amount";
import { cn } from "@/components/ui/cn";
import { Countdown } from "@/components/ui/countdown";
import { DateText } from "@/components/ui/date-text";
import { useProtocolNow } from "@/components/ui/use-now";
import { formatBps } from "@/lib/format";

import { AgentAction } from "./actions";
import { liveDebt } from "./interest";
import { cardState, type Overview } from "./state";

const TONES = {
  amber: "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
  red: "border-red-300/70 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
  neutral: "border-line bg-card text-fg",
} as const;

const ICON_TONES = {
  amber: "text-amber-600 dark:text-amber-300",
  red: "text-red-600 dark:text-red-300",
  neutral: "text-muted",
} as const;

function Banner({ tone, icon, title, children, role = "status" }: { tone: keyof typeof TONES; icon: ReactNode; title: ReactNode; children?: ReactNode; role?: "status" | "alert" }) {
  return (
    <section role={role} className={cn("rounded-card border p-4 sm:p-5", TONES[tone])}>
      <div className="flex gap-3">
        <span className={cn("mt-0.5 shrink-0 [&_svg]:size-5", ICON_TONES[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">{title}</h2>
          {children && <div className="mt-1 text-sm leading-relaxed opacity-90">{children}</div>}
        </div>
      </div>
    </section>
  );
}

/**
 * Carried debt (spec §4.6): amount (ticking), the grace-deadline countdown on
 * the protocol clock, and what happens next.
 */
export function CarriedDebtBanner({ data }: { data: Overview }) {
  const now = useProtocolNow(data.rates.protocolNow, data.rates.fetchedAtMs);
  const position = data.position;
  if (!position || BigInt(position.carriedDebt) <= 0n) return null;
  const carried = liveDebt(position, data.rates, now).carriedDebt;
  const deadline = position.graceDeadline !== null ? Number(position.graceDeadline) : null;
  const pastDeadline = deadline !== null && now >= deadline;

  return (
    <Banner
      tone="amber"
      role="alert"
      icon={<Hourglass />}
      title={
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span>Carried debt</span>
          <Amount value={carried} className="text-base" />
        </span>
      }
    >
      <p>
        A buyer walked away from one of your deals, so its debt moved to you. It keeps accruing {formatBps(data.rates.agentAprBps)} APR and is repaid first from your
        next settlements and your card balance. It also reduces the credit on your other deals.
      </p>
      {deadline !== null && (
        <p className="mt-2 font-semibold">
          {pastDeadline ? "Grace period ended on " : "Grace period ends "}
          <DateText value={deadline} />
          {!pastDeadline && (
            <>
              {" · "}
              <Countdown to={deadline} now={data.rates.protocolNow} fetchedAtMs={data.rates.fetchedAtMs} className="font-semibold" />
            </>
          )}
        </p>
      )}
      <p className="mt-1 text-xs opacity-80">
        {pastDeadline
          ? "explorador can now write it off against its first-loss capital, which blocks new credit on your account."
          : "If it's still unpaid by then, it's written off against explorador's first-loss capital and new credit is blocked."}
      </p>
    </Banner>
  );
}

/** Written off → blocked from new credit. */
export function BlockedBanner({ data }: { data: Overview }) {
  if (!data.position?.blocked) return null;
  return (
    <Banner tone="red" role="alert" icon={<Ban />} title="New credit is blocked">
      Carried debt on your account was written off after the grace period. You can still spend your card balance, but no new credit is available.
    </Banner>
  );
}

/** Card disabled on-chain after activation. */
export function PausedCardBanner({ data }: { data: Overview }) {
  if (cardState(data) !== "paused") return null;
  return (
    <Banner tone="neutral" icon={<CirclePause />} title="Your card is paused">
      <p>Purchases are declined until you resume it. Resuming takes one passkey prompt.</p>
      <div className="mt-3 max-w-xs">
        <AgentAction action={{ action: "enable_card" }} variant="secondary">
          Resume card
        </AgentAction>
      </div>
    </Banner>
  );
}

/** The chain couldn't be read: say which numbers are shown. */
export function DataNotice({ data }: { data: Overview }) {
  if (!data.onboarding.smartAccount || data.positionSource === "chain") return null;
  return (
    <Banner tone="neutral" icon={<CloudOff />} title={data.positionSource === "cache" ? "Showing your last known balances" : "Waiting for Stellar"}>
      {data.positionSource === "cache" ? (
        <>
          Live data from Stellar is unavailable right now{data.positionAsOf ? <>; these are from <DateText value={data.positionAsOf} format="time" /></> : null}. They update by themselves as soon as
          it&apos;s back.
        </>
      ) : (
        "Your balances will appear as soon as the pool on Stellar can be read. This page keeps trying."
      )}
    </Banner>
  );
}
