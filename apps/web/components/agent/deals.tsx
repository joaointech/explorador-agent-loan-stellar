import Link from "next/link";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import type { AgentDealDto } from "@/lib/api-types";
import { DealStatusBadge, EmptyState, OverdueBadge } from "@/components/common";
import { Progress } from "@/components/ui/progress";
import { formatDay, formatStroops, relativeDays } from "@/lib/format";
import { toBig } from "./money";

export function DealsList({ deals, today }: { deals: AgentDealDto[]; today: number }) {
  if (deals.length === 0) {
    return (
      <EmptyState title="No deals yet">
        When explorador registers a signed CPCV for you, it appears here and your credit opens automatically.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {deals.map((d) => (
        <DealCard key={d.cpcvId} deal={d} today={today} />
      ))}
    </div>
  );
}

function DealCard({ deal: d, today }: { deal: AgentDealDto; today: number }) {
  const limit = toBig(d.creditLimit);
  const used = toBig(d.used);
  const pct = limit > 0n ? Number((used * 10_000n) / limit) / 100 : 0;
  const active = d.status === "MINTED";
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{d.noteId ? `Deal #${d.noteId}` : "Deal (pending)"}</span>
        <span className="flex items-center gap-1.5">
          {d.overdue && active && <OverdueBadge />}
          <DealStatusBadge status={d.status} />
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted">Your commission</dt>
        <dd className="text-right font-semibold tabular-nums">{formatStroops(d.agentCommission)}</dd>
        <dt className="text-muted">Credit limit</dt>
        <dd className="text-right font-semibold tabular-nums">{formatStroops(d.creditLimit)}</dd>
        <dt className="text-muted">Used</dt>
        <dd className="text-right font-semibold tabular-nums">{formatStroops(d.used)}</dd>
      </dl>
      {active && <Progress value={pct} className="mt-3" />}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted">
          <CalendarClock className="size-3.5" />
          Escritura {formatDay(d.escrituraDay)}
          {active && <span className="font-semibold text-ink">· {relativeDays(d.escrituraDay, today)}</span>}
        </span>
        {d.noteId && (
          <Link href={`/registry/${d.noteId}`} className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
            On-chain <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
