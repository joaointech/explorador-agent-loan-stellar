"use client";
import { CircleAlert, Clock, Landmark, Layers, Wallet } from "lucide-react";
import type { AdminOverviewResponse } from "@/lib/api-types";
import { Address, EmptyState, ErrorNote, StatPill } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { PollState } from "@/lib/client/hooks";
import { formatBps, formatCents, formatDateTime, formatPct, formatProtocolDate, formatStroops, stroopsToEur } from "@/lib/format";
import type { AdminTab } from "./admin-app";
import { AmountAction } from "./amount-action";

export function Dashboard({ overview, onChanged, onGo }: { overview: PollState<AdminOverviewResponse>; onChanged: () => void; onGo: (t: AdminTab) => void }) {
  const d = overview.data;
  if (!d) {
    return overview.error ? (
      <ErrorNote>Could not load the overview: {overview.error.message}</ErrorNote>
    ) : (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }
  const p = d.pool;
  const s = p.stats;
  const leverage = s.leverageX100 / 100;
  const alerts = d.failedDraws.length + d.agentsPastGrace.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill label="Pool TVL" value={formatStroops(p.tvl, { whole: true })} hint={`${p.notes.active} active notes`} />
        <StatPill label="Senior assets" value={formatStroops(s.seniorAssets, { whole: true })} hint={`APY ${formatPct(p.apy.projectedSenior)} projected`} />
        <StatPill label="First-loss assets" value={formatStroops(s.juniorAssets, { whole: true })} hint={`coverage ${formatPct(p.coverage, 1)}`} />
        <StatPill label="Outstanding debt" value={formatStroops(s.totalDebt, { whole: true })} hint={`${formatStroops(s.totalPrincipal, { whole: true })} principal`} />
        <StatPill label="Utilization" value={formatBps(s.utilizationBps, 1)} hint="debt ÷ assets" />
        <StatPill label="Leverage" value={`${leverage.toFixed(2)}×`} hint={`cap ${s.params.maxLeverage}× first-loss`} />
        <StatPill label="Idle liquidity" value={formatStroops(s.lendable, { whole: true })} hint={`headroom ${formatStroops(s.leverageHeadroom, { whole: true })}`} />
        <StatPill label="Card balances" value={formatStroops(s.totalCardBalances, { whole: true })} hint="owed to agents" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-2 font-bold">
            <Layers className="size-5 text-primary" /> Junior tranche (first-loss)
          </div>
          <p className="mt-1 text-sm text-muted">
            {formatStroops(s.juniorAssets)} · leverage {leverage.toFixed(2)}× of {s.params.maxLeverage}×
          </p>
          <Progress className="mt-3" value={(leverage / s.params.maxLeverage) * 100} indicatorClassName={leverage / s.params.maxLeverage >= 0.8 ? "bg-amber-500" : undefined} />
          <div className="mt-4">
            <AmountAction
              id="junior-amount"
              onDone={onChanged}
              actions={[
                { label: "Deposit", url: "/api/admin/junior/deposit" },
                { label: "Withdraw", url: "/api/admin/junior/withdraw", variant: "secondary" },
              ]}
            />
            <p className="mt-2 text-xs text-muted">Moves tEURC between the treasury and the first-loss tranche. Withdrawals are capped by the leverage limit.</p>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 font-bold">
            <Landmark className="size-5 text-primary" /> Protocol fees
          </div>
          <p className="mt-1 text-sm text-muted">
            {formatStroops(s.feesAccrued)} accrued · {formatBps(s.params.protocolFeeBps, 0)} of agent interest
          </p>
          <div className="mt-4">
            <AmountAction
              key={s.feesAccrued}
              id="fees-amount"
              onDone={onChanged}
              max={stroopsToEur(s.feesAccrued)}
              defaultValue={stroopsToEur(s.feesAccrued) > 0 ? (Math.floor(stroopsToEur(s.feesAccrued) * 100) / 100).toFixed(2) : ""}
              actions={[{ label: "Claim", url: "/api/admin/fees/claim" }]}
            />
            <p className="mt-2 text-xs text-muted">Claimed fees go to the treasury.</p>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 font-bold">
            <Wallet className="size-5 text-primary" /> Treasury
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{formatStroops(d.treasury.teurcBalance)}</div>
          <div className="mt-1">
            <Address value={d.treasury.address} />
          </div>
          <p className="mt-3 text-xs text-muted">
            Pays each total commission at the escritura and covers unfunded card spends. Written off to date: {formatStroops(s.writtenOffTotal)}.
          </p>
        </Card>
      </div>

      <section>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          Alerts {alerts > 0 && <Badge tone="red">{alerts}</Badge>}
        </h2>
        {alerts === 0 ? (
          <EmptyState title="All clear" className="mt-3">
            No failed card draws and no agents past their grace deadline.
          </EmptyState>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {d.failedDraws.map((f) => (
              <div key={f.id} className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-500/30 dark:bg-red-500/10">
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-600" />
                <div className="min-w-0">
                  <p className="font-bold text-red-800 dark:text-red-200">Unfunded card spend — covered by treasury</p>
                  <p className="mt-0.5 text-ink-soft">
                    {formatCents(f.amountCents)} at {f.merchant} · {f.agentEmail}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatDateTime(f.createdAt)} · {f.attempts} of 3 attempts
                    {f.lastError ? ` · ${f.lastError}` : ""}
                  </p>
                </div>
              </div>
            ))}
            {d.agentsPastGrace.map((a) => (
              <div key={a.userId} className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                <Clock className="mt-0.5 size-5 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-amber-900 dark:text-amber-100">Past grace deadline</p>
                  <p className="mt-0.5 text-ink-soft">
                    {a.email} owes {formatStroops(a.carriedDebt)} carried debt since {formatProtocolDate(a.graceDeadline)}.
                  </p>
                  <Button size="xs" variant="warning" className="mt-2" onClick={() => onGo("agents")}>
                    Review write-off →
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
