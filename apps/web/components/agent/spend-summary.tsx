"use client";
import { TrendingUp } from "lucide-react";
import type { AgentOverviewResponse } from "@/lib/api-types";
import { formatStroops, tickDebt } from "@/lib/format";
import { useNow } from "@/lib/client/hooks";
import { formatStroopsPrecise, maxBig, toBig } from "./money";

/** "Available to spend" with the live-ticking debt breakdown. */
export function SpendSummary({ data, receivedAt }: { data: AgentOverviewResponse; receivedAt: number | null }) {
  const now = useNow(1000);
  const p = data.position;
  const elapsed = receivedAt ? Math.max(0, (now - receivedAt) / 1000) : 0;
  const debt0 = toBig(p?.totalDebt);
  const principal = toBig(p?.totalPrincipal);
  const debt = tickDebt(debt0, data.interest.aprBps, elapsed);
  const interest = maxBig(0n, debt - principal);
  const cardBalance = toBig(p?.cardBalance);
  const borrowable = toBig(p?.borrowableNow);

  return (
    <div className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <p className="eyebrow">Available to spend</p>
      <div className="mt-1 text-[44px] font-bold leading-none tracking-tight tabular-nums text-ink sm:text-5xl">{formatStroops(data.spendable)}</div>
      {toBig(data.pendingHolds) > 0n && (
        <p className="mt-1 text-xs text-muted">{formatStroops(data.pendingHolds)} held for purchases still confirming</p>
      )}
      <dl className="mt-5 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-2xl bg-warm px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Card balance</dt>
          <dd className="mt-0.5 truncate font-bold tabular-nums">{formatStroops(cardBalance)}</dd>
        </div>
        <div className="rounded-2xl bg-warm px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Credit available</dt>
          <dd className="mt-0.5 truncate font-bold tabular-nums">{formatStroops(borrowable)}</dd>
        </div>
        <div className="rounded-2xl bg-warm px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Debt</dt>
          <dd className="mt-0.5 truncate font-bold tabular-nums">{formatStroops(debt)}</dd>
        </div>
      </dl>
      {debt > 0n && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-faint px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-ink-soft">
            <TrendingUp className="size-3.5 text-primary" />
            {formatStroops(principal)} spent on credit + interest
          </span>
          <span className="font-mono font-semibold tabular-nums text-primary" aria-live="off">
            {formatStroopsPrecise(interest, 6)}
          </span>
          <span className="w-full text-[11px] text-muted">
            {(data.interest.aprBps / 100).toFixed(0)}% APR on what you use, accrued every second. Repaid automatically at the escritura.
          </span>
        </div>
      )}
    </div>
  );
}
