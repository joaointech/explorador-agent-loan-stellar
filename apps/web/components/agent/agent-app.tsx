"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgentOverviewResponse } from "@/lib/api-types";
import { ErrorNote, Eyebrow } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/client/api";
import { usePoll } from "@/lib/client/hooks";
import { protocolDay } from "@/lib/format";
import { ActivityList } from "./activity";
import { CardPanel } from "./card-panel";
import { CarriedDebtBanner } from "./carried-debt-banner";
import { DealsList } from "./deals";
import { OnboardingStepper } from "./onboarding";
import { SettingsPanel } from "./settings";
import { SimulatePurchaseSheet } from "./simulate-sheet";
import { SpendSummary } from "./spend-summary";

export function AgentApp() {
  const router = useRouter();
  const { data, error, loading, receivedAt, refresh } = usePoll<AgentOverviewResponse>("/api/agent/overview", 5000);
  const status = error instanceof ApiClientError ? error.status : null;

  React.useEffect(() => {
    if (status === 401) router.replace("/login?next=/agent");
  }, [status, router]);

  if (status === 403) {
    return (
      <Shell>
        <ErrorNote>This page is for agents. You are signed in with an explorador admin account.</ErrorNote>
        <Button asChild className="mt-4">
          <Link href="/admin">Go to admin →</Link>
        </Button>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        {error && status !== 401 ? (
          <ErrorNote>
            Could not load your account: {error.message}{" "}
            <button className="font-semibold underline" onClick={() => void refresh()}>
              Retry
            </button>
          </ErrorNote>
        ) : (
          <AgentSkeleton loading={loading} />
        )}
      </Shell>
    );
  }

  const onboarded = data.onboarding.cardActivated && (data.onboarding.passkey || data.signerKind === "demo-ed25519");
  const today = protocolDay(data.demo.protocolNow);
  const firstName = (data.user.displayName ?? data.user.email.split("@")[0]).split(" ")[0];

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Agent</Eyebrow>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">
            Hello, <span className="text-primary">{firstName}</span>
          </h1>
        </div>
      </div>

      {error && <ErrorNote className="mt-4">Showing the last known data — {error.message}</ErrorNote>}

      <div className="mt-5 flex flex-col gap-3">
        <CarriedDebtBanner data={data} />
        {!onboarded && <OnboardingStepper data={data} onChanged={refresh} />}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-5">
          <CardPanel data={data} />
          <SpendSummary data={data} receivedAt={receivedAt} />
          <div>
            <SimulatePurchaseSheet disabled={!data.onboarding.cardActivated} lithic={Boolean(data.card?.hasLithic)} onDone={() => void refresh()} />
            {!data.onboarding.cardActivated && <p className="mt-2 text-center text-xs text-muted">Activate your card to try a purchase.</p>}
          </div>
          <div className="hidden lg:block">
            <SettingsPanel data={data} onChanged={refresh} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          <section>
            <SectionTitle title="Your deals" hint="Each signed CPCV opens credit of 50% of your commission." />
            <DealsList deals={data.deals} today={today} />
          </section>
          <section>
            <SectionTitle title="Activity" />
            <ActivityList items={data.activity} />
          </section>
          <div className="lg:hidden">
            <SettingsPanel data={data} onChanged={refresh} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">{children}</div>;
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

function AgentSkeleton({ loading }: { loading: boolean }) {
  return (
    <div aria-busy={loading} className="grid gap-5 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-5">
        <Skeleton className="mx-auto aspect-[1.586] w-full max-w-[380px] rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
