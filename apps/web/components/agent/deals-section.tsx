"use client";

import { ArrowUpRight, Landmark } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Amount } from "@/components/ui/amount";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { DateText } from "@/components/ui/date-text";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useProtocolNow } from "@/components/ui/use-now";
import { formatEur } from "@/lib/format";
import type { AgentDeal } from "@/lib/types/api";

import { liveDebt, type Rates } from "./interest";
import type { Overview } from "./state";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-heading">{children}</dd>
    </div>
  );
}

/** `used` is null while the position is unknown (Stellar unreachable and nothing cached). */
function DealCard({ deal, used, rates }: { deal: AgentDeal; used: bigint | null; rates: Rates }) {
  const active = deal.status === "MINTED";
  const limit = BigInt(deal.creditLimit);
  return (
    <li className="rounded-card border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold text-heading">{deal.noteId !== null ? `Deal #${deal.noteId}` : "Deal"}</p>
          <p className="text-xs text-muted">CPCV Note</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <StatusBadge status={deal.status} />
          {deal.overdue && <StatusBadge status="Overdue" />}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Item label="Your commission">
          <Amount value={deal.agentCommission} />
        </Item>
        <Item label="Credit limit">
          <Amount value={deal.creditLimit} />
        </Item>
        {active && (
          <Item label="Used">
            <Amount value={used} />
          </Item>
        )}
        <Item label="Escritura">
          <DateText value={deal.escrituraDay} />
          {active && (
            <span className="mt-0.5 block text-xs font-medium text-muted">
              <Countdown to={deal.escrituraDay} now={rates.protocolNow} fetchedAtMs={rates.fetchedAtMs} />
            </span>
          )}
        </Item>
      </dl>

      {active && used !== null && limit > 0n && (
        <ProgressBar
          className="mt-4"
          size="sm"
          tone="auto"
          value={used}
          max={limit}
          valueText={`${formatEur(used)} of ${formatEur(limit)}`}
          label="Credit used"
          showValue
        />
      )}

      {deal.status === "SETTLED" && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
          {deal.agentPayout ? `Escritura done: ${formatEur(deal.agentPayout)} added to your card balance.` : "Escritura done: debt repaid, the rest of your half went to your card balance."}
        </p>
      )}
      {deal.status === "CANCELLED" && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {deal.debtCarried && BigInt(deal.debtCarried) > 0n
            ? `The buyer withdrew: ${formatEur(deal.debtCarried)} of debt moved to your carried debt.`
            : "The buyer withdrew. No debt was carried over."}
        </p>
      )}
      {deal.status === "WRITTEN_OFF" && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
          The buyer withdrew and the carried debt was written off after the grace period.
        </p>
      )}

      {deal.noteId !== null && (
        <Link href={`/registry/${deal.noteId}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-text underline-offset-4 hover:underline">
          View in the registry
          <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      )}
    </li>
  );
}

/** One card per CPCV Note: status, commission, credit limit, debt used (live), escritura countdown, registry link. */
export function DealsSection({ data }: { data: Overview }) {
  const now = useProtocolNow(data.rates.protocolNow, data.rates.fetchedAtMs);
  const live = data.position ? liveDebt(data.position, data.rates, now) : null;
  const usedByNote = new Map(live?.lines.map((l) => [l.noteId, l.debt]) ?? []);
  const activeCount = data.deals.filter((d) => d.status === "MINTED").length;

  return (
    <Card radius="3xl" padding="md">
      <CardHeader
        titleAs="h2"
        title="Deals"
        description="Credit of half your commission on each deal, until its escritura."
        action={data.deals.length > 0 ? <Badge tone="blue">{activeCount} active</Badge> : undefined}
      />
      {data.deals.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Landmark />}
          title="No deals yet"
          description="When a CPCV is signed, explorador proves it on-chain and mints a CPCV Note to your account. Until then your credit is €0."
        />
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {data.deals.map((deal) => (
            <DealCard
              key={deal.cpcvId}
              deal={deal}
              rates={data.rates}
              used={data.position === null ? null : ((deal.noteId !== null ? usedByNote.get(deal.noteId) : undefined) ?? BigInt(deal.used))}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
