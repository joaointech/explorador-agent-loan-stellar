"use client";

import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Eyebrow } from "@/components/ui/typography";

import { ActivitySection } from "./activity-section";
import { BlockedBanner, CarriedDebtBanner, DataNotice, PausedCardBanner } from "./banners";
import { CardPanel } from "./card-panel";
import { useAgentApp } from "./context";
import { DealsSection } from "./deals-section";
import { OnboardingPanel } from "./onboarding-panel";
import { SettingsSection } from "./settings-section";
import { SpendSummary } from "./spend-summary";
import { firstName, type Overview } from "./state";

export interface RefreshStatus {
  refreshing: boolean;
  error: string | null;
}

function LiveStatus({ data, status }: { data: Overview; status: RefreshStatus }) {
  const { refresh } = useAgentApp();
  if (!data.onboarding.smartAccount) return null;
  const badge = status.error
    ? { tone: "amber" as const, label: "Can't refresh", pulse: false, title: status.error }
    : data.positionSource === "chain"
      ? { tone: "emerald" as const, label: "Live", pulse: true, title: "Read from Stellar; refreshes every 10 seconds" }
      : data.positionSource === "cache"
        ? { tone: "amber" as const, label: "Last known", pulse: false, title: "Stellar can't be read right now: last known balances" }
        : { tone: "neutral" as const, label: "Connecting", pulse: true, title: "Waiting for the first read from Stellar" };
  return (
    <div className="flex items-center gap-1">
      <Badge tone={badge.tone} dot pulse={badge.pulse} title={badge.title}>
        {badge.label}
      </Badge>
      <IconButton label="Refresh now" size="sm" onClick={() => void refresh()} disabled={status.refreshing}>
        <RefreshCw aria-hidden className={cn("size-4", status.refreshing && "animate-spin")} />
      </IconButton>
    </div>
  );
}

/**
 * The agent app (spec §10.2 /agent), mobile first: onboarding while
 * incomplete, banners, the card, "Available to spend" with Simulate purchase,
 * then deals, activity and settings. Two columns from `lg`.
 */
export function AgentDashboard({ data, status }: { data: Overview; status: RefreshStatus }) {
  const name = firstName(data);
  const hasAccount = data.onboarding.smartAccount;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-12 sm:pt-8 sm:pb-16">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Agent</Eyebrow>
          <h1 className="mt-1 truncate font-display text-2xl leading-tight font-bold tracking-tight text-heading sm:text-3xl">
            {name ? `Hello, ${name}` : "Hello"}
          </h1>
        </div>
        <LiveStatus data={data} status={status} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-col gap-5">
          <OnboardingPanel data={data} />
          <BlockedBanner data={data} />
          <CarriedDebtBanner data={data} />
          <PausedCardBanner data={data} />
          <DataNotice data={data} />
          <CardPanel data={data} />
          {hasAccount && <SpendSummary data={data} />}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {hasAccount && <DealsSection data={data} />}
          {hasAccount && <ActivitySection data={data} />}
          <SettingsSection data={data} />
        </div>
      </div>
    </div>
  );
}
