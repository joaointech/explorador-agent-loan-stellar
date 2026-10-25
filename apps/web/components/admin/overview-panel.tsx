"use client";

import { CircleCheck, CreditCard, Hourglass, RotateCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DateText } from "@/components/ui/date-text";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatPill } from "@/components/ui/stat-pill";
import { DataTable } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/typography";
import { formatBps, formatMultiplier, formatPercent, formatSharePrice } from "@/lib/format";
import type { AdminAgentRow, AdminOverviewResponse } from "@/lib/types/api";

import { LoadError, WarningsBanner } from "./confirm-dialog";
import { FeesCard, JuniorTrancheCard } from "./treasury-cards";
import { useAdminResource } from "./use-admin-resource";
import { WriteOffDialog } from "./write-off-dialog";

const MAX_DRAW_ATTEMPTS = 3;

function coverage(senior: string, junior: string): number | null {
  const s = Number(senior);
  const j = Number(junior);
  return s + j > 0 ? j / (s + j) : null;
}

function PoolStats({ stats }: { stats: AdminOverviewResponse["stats"] }) {
  if (!stats) return null;
  const cap = stats.params.maxLeverage;
  return (
    <section aria-labelledby="pool-title" className="flex flex-col gap-4">
      <h2 id="pool-title" className="text-lg font-bold text-heading">
        Pool
      </h2>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <StatPill label="Senior (investors)" value={<Amount value={stats.seniorAssets} decimals={0} />} hint={`${formatSharePrice(stats.sharePriceScaled)} per eaSR`} />
        <StatPill
          label="Junior (first-loss)"
          value={<Amount value={stats.juniorAssets} decimals={0} />}
          hint={`${formatPercent(coverage(stats.seniorAssets, stats.juniorAssets), { decimals: 1 })} of the pool`}
        />
        <StatPill label="Outstanding debt" value={<Amount value={stats.totalDebt} decimals={0} />} hint={<>principal <Amount value={stats.totalPrincipal} /></>} />
        <StatPill label="Idle liquidity" value={<Amount value={stats.lendable} decimals={0} />} hint={`utilization ${formatBps(stats.utilizationBps)}`} />
      </div>
      <Card padding="sm" className="grid gap-5 sm:grid-cols-[2fr_1fr_1fr] sm:items-center">
        <ProgressBar
          label="Leverage (debt ÷ junior)"
          value={stats.leverageX100}
          max={cap * 100}
          tone="auto"
          showValue
          valueText={`${formatMultiplier(stats.leverageX100)} of the ${cap}× cap`}
        />
        <div>
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Protocol fees accrued</p>
          <Amount value={stats.feesAccrued} className="text-lg font-bold text-heading" />
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Written off (total)</p>
          <Amount value={stats.writtenOffTotal} className="text-lg font-bold text-heading" />
        </div>
      </Card>
    </section>
  );
}

function Alerts({ data, onWriteOff }: { data: AdminOverviewResponse; onWriteOff: (agent: AdminAgentRow) => void }) {
  const { failedDraws, agentsPastGrace } = data;
  if (failedDraws.length === 0 && agentsPastGrace.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <CircleCheck aria-hidden className="size-4" /> No alerts: every card spend is funded on-chain and no agent is past their grace deadline.
      </p>
    );
  }
  return (
    <section aria-labelledby="alerts-title" className="flex flex-col gap-4">
      <h2 id="alerts-title" className="flex items-center gap-2 text-lg font-bold text-heading">
        <TriangleAlert aria-hidden className="size-5 text-amber-500" /> Alerts
      </h2>
      {failedDraws.length > 0 && (
        <Card className="flex flex-col gap-4">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <CreditCard aria-hidden className="size-5 text-red-500" /> Unfunded card spend — covered by treasury
              </span>
            }
            description="Purchases approved at the card network whose on-chain draw failed. Each is retried automatically up to 3 times; after that, treasury covers it."
            action={<Badge tone="red">{failedDraws.length}</Badge>}
          />
          <DataTable
            rows={failedDraws}
            rowKey={(d) => d.id}
            columns={[
              { key: "agent", header: "Agent", cell: (d) => <span className="font-medium text-heading">{d.agentEmail}</span> },
              { key: "merchant", header: "Merchant", cell: (d) => d.merchant },
              { key: "amount", header: "Amount", align: "right", cell: (d) => <Amount value={d.amount} /> },
              {
                key: "attempts",
                header: "Attempts",
                cell: (d) =>
                  d.attempts >= MAX_DRAW_ATTEMPTS ? (
                    <Badge tone="red">{`${d.attempts} of ${MAX_DRAW_ATTEMPTS} · no more retries`}</Badge>
                  ) : (
                    <Badge tone="amber" dot pulse>{`${d.attempts} of ${MAX_DRAW_ATTEMPTS} · retrying`}</Badge>
                  ),
              },
              { key: "when", header: "When", hideBelow: "md", cell: (d) => <DateText value={d.createdAt} format="datetime" /> },
            ]}
          />
        </Card>
      )}
      {agentsPastGrace.length > 0 && (
        <Card className="flex flex-col gap-4">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Hourglass aria-hidden className="size-5 text-red-500" /> Agents past their grace deadline
              </span>
            }
            description="Carried debt from cancelled deals that was not repaid within 180 protocol days. Write it off to take the loss (junior first)."
            action={<Badge tone="red">{agentsPastGrace.length}</Badge>}
          />
          <ul className="divide-y divide-line rounded-xl border border-line">
            {agentsPastGrace.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-heading">{a.email}</p>
                  <p className="text-sm text-muted">
                    Carried debt <Amount value={a.carriedDebt} className="font-semibold text-red-600 dark:text-red-400" /> · deadline{" "}
                    <DateText value={a.graceDeadline} />
                  </p>
                </div>
                <Button variant="danger" size="sm" onClick={() => onWriteOff(a)}>
                  Write off
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <StatPill key={i} label="Loading" value="" loading />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-card" />
        <Skeleton className="h-80 rounded-card" />
      </div>
    </div>
  );
}

/** /admin: pool stats, treasury actions and alerts (spec §10.2). Loading it also kicks the card draw retry sweep. */
export function OverviewPanel() {
  const { data, error, loading, refreshing, refresh } = useAdminResource<AdminOverviewResponse>("/api/admin/overview");
  const [writeOff, setWriteOff] = useState<AdminAgentRow | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Overview"
        title="Pool health and"
        accent="alerts"
        description="Live pool state from advance_pool, explorador's treasury actions, and what needs attention."
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RotateCw className="size-4" />} loading={refreshing && !loading} onClick={refresh}>
              Refresh
            </Button>
            <Button href="/admin/cpcvs/new" size="sm" arrow>
              New CPCV
            </Button>
          </>
        }
      />
      {loading ? (
        <OverviewSkeleton />
      ) : !data ? (
        error && <LoadError error={error} onRetry={refresh} />
      ) : (
        <>
          <WarningsBanner warnings={data.warnings} />
          <Alerts data={data} onWriteOff={setWriteOff} />
          <PoolStats stats={data.stats} />
          <div className="grid gap-6 lg:grid-cols-2">
            <JuniorTrancheCard stats={data.stats} onDone={refresh} />
            <FeesCard stats={data.stats} onDone={refresh} />
          </div>
        </>
      )}
      <WriteOffDialog agent={writeOff} onOpenChange={(open) => !open && setWriteOff(null)} onDone={refresh} />
    </div>
  );
}
