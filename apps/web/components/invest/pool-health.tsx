import { CircleAlert, Coins, Gauge, Landmark, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardRow } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatPill } from "@/components/ui/stat-pill";
import { Eyebrow } from "@/components/ui/typography";
import { formatBps, formatDate, formatEur, formatNumber, formatPercent } from "@/lib/format";
import type { PoolStatsResponse, RegistryStatus } from "@/lib/types/api";

import { apyText, leverageText } from "./format";
import { LEVERAGE_UNBOUNDED, coverage, type Remote } from "./model";

const NOTE_STATUSES: RegistryStatus[] = ["Active", "Settled", "Cancelled", "WrittenOff"];

function SectionHeading({ asOf }: { asOf?: number }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Eyebrow>Pool health</Eyebrow>
        <h2 id="pool-health" className="mt-2 text-2xl font-bold tracking-tight text-heading sm:text-3xl">
          Live from the pool contract
        </h2>
      </div>
      {asOf !== undefined && <p className="text-sm text-muted">Protocol date {formatDate(asOf)}</p>}
    </div>
  );
}

/** Senior vs junior as one bar with a 2 px gap between the segments. */
function TrancheBar({ senior, junior }: { senior: bigint; junior: bigint }) {
  const total = senior + junior;
  const seniorPct = total > 0n ? Number((senior * 10_000n) / total) / 100 : 0;
  const juniorPct = total > 0n ? 100 - seniorPct : 0;
  return (
    <div>
      <ul aria-hidden className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-muted">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-1" /> Senior (investors)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-2" /> Junior (explorador, first-loss)
        </li>
      </ul>
      <div
        role="img"
        aria-label={total > 0n ? `Senior ${seniorPct.toFixed(1)}%, junior ${juniorPct.toFixed(1)}% of pool assets` : "The pool has no assets yet"}
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/70"
      >
        {seniorPct > 0 && <div className="h-full bg-chart-1" style={{ width: `${seniorPct}%` }} />}
        {juniorPct > 0 && <div className="h-full bg-chart-2" style={{ width: `${juniorPct}%` }} />}
      </div>
    </div>
  );
}

function MetricCard({ icon, title, children, description }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary-tint text-primary-text ring-1 ring-primary/15 [&_svg]:size-[18px]">{icon}</span>
        <h3 className="text-base font-bold text-heading">{title}</h3>
      </div>
      {description && <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>}
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </Card>
  );
}

function LoadingState() {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <StatPill key={i} label="" value="" loading />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="flex flex-col gap-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Pool health (spec §10.2 /invest): TVL, tranches and first-loss coverage,
 * debt, utilization, leverage vs the cap, idle liquidity, yields, fees,
 * write-offs and notes by status, from GET /api/pool/stats.
 */
export function PoolHealth({ stats, onRetry }: { stats: Remote<PoolStatsResponse>; onRetry: () => void }) {
  const data = stats.data;
  if (!data) {
    return (
      <section aria-labelledby="pool-health" className="flex flex-col gap-5">
        <SectionHeading />
        {stats.error ? (
          <Card className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-fg">
              <CircleAlert aria-hidden className="mt-0.5 size-[18px] shrink-0 text-red-500" />
              Pool stats are unavailable right now ({stats.error}).
            </p>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </Card>
        ) : (
          <LoadingState />
        )}
      </section>
    );
  }

  const s = data.stats;
  const senior = BigInt(s.seniorAssets);
  const junior = BigInt(s.juniorAssets);
  const debt = BigInt(s.totalDebt);
  const principal = BigInt(s.totalPrincipal);
  const interest = debt > principal ? debt - principal : 0n;
  const tvl = senior + junior;
  const cover = coverage(senior, junior);
  const capX100 = s.params.maxLeverage * 100;
  const unbounded = s.leverageX100 >= LEVERAGE_UNBOUNDED;

  return (
    <section aria-labelledby="pool-health" className="flex flex-col gap-5">
      <SectionHeading asOf={data.clock.protocolNow} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill label="Pool TVL" icon={<Coins />} value={formatEur(tvl, { decimals: 0 })} hint="senior + junior assets" />
        <StatPill label="Outstanding debt" icon={<Landmark />} value={formatEur(debt, { decimals: 0 })} hint={`incl. ${formatEur(interest)} interest`} />
        <StatPill label="Utilization" icon={<Gauge />} value={formatBps(s.utilizationBps, { maxDecimals: 1 })} hint="debt / (debt + idle cash)" />
        <StatPill label="Idle liquidity" icon={<Wallet />} value={formatEur(s.lendable, { decimals: 0 })} hint="withdrawable or lendable now" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={<ShieldCheck />} title="Tranches and first-loss cover" description="explorador's junior capital absorbs write-offs before any senior depositor.">
          <TrancheBar senior={senior} junior={junior} />
          <div className="mt-3">
            <CardRow label="Senior assets" value={formatEur(senior)} />
            <CardRow label="Junior (first-loss) assets" value={formatEur(junior)} />
            <CardRow label="Coverage" value={cover === null ? "—" : formatPercent(cover)} />
          </div>
        </MetricCard>

        <MetricCard icon={<Gauge />} title="Leverage" description={`Total debt may not exceed ${s.params.maxLeverage}× the junior assets.`}>
          <p className="text-3xl font-bold tracking-tight text-heading">{leverageText(s.leverageX100)}</p>
          <ProgressBar
            className="mt-3"
            label="Debt / junior"
            value={unbounded ? capX100 : s.leverageX100}
            max={capX100}
            tone="auto"
            showValue
            valueText={unbounded ? `No first-loss capital (cap ${s.params.maxLeverage}×)` : `${leverageText(s.leverageX100)} of ${s.params.maxLeverage}× cap`}
          />
          <div className="mt-3">
            <CardRow label="Room to lend under the cap" value={formatEur(s.leverageHeadroom)} />
            <CardRow label="Utilization" value={formatBps(s.utilizationBps, { maxDecimals: 1 })} />
          </div>
        </MetricCard>

        <MetricCard icon={<TrendingUp />} title="Yield" description={`Agents pay ${formatBps(s.params.agentAprBps)} APR; ${formatBps(s.params.protocolFeeBps)} of interest is the protocol fee.`}>
          <div>
            <CardRow label="Target senior APY" value={apyText(data.apy.target)} />
            <CardRow label="Projected senior APY" value={<span className="text-primary-text">{apyText(data.apy.projectedSenior)}</span>} />
            <CardRow label="7-day trailing APY" value={data.apy.trailing7dSenior === null ? <span className="text-muted">needs a week of history</span> : apyText(data.apy.trailing7dSenior)} />
            <CardRow label="Projected junior APY" value={apyText(data.apy.projectedJunior)} />
          </div>
        </MetricCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader
            title="Notes by status"
            description="Every CPCV Note backing the pool, in the public registry."
            action={
              <Link href="/registry" className="text-sm font-semibold text-primary-text underline-offset-4 hover:underline">
                Registry →
              </Link>
            }
          />
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NOTE_STATUSES.map((status) => (
              <li key={status} className="flex flex-col items-start gap-2 rounded-xl bg-card-muted p-3 ring-1 ring-line">
                <StatusBadge status={status} />
                <span className="text-2xl font-bold text-heading">{formatNumber(data.notes[status] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Fees and losses" description="What explorador has earned and what defaults have cost the pool." />
          <div className="mt-3">
            <CardRow label="Protocol fees accrued" value={formatEur(s.feesAccrued)} />
            <CardRow label="Total written off" value={formatEur(s.writtenOffTotal)} />
            <CardRow label="Total advanced to agents" value={formatEur(data.totalAdvanced)} />
          </div>
        </Card>
      </div>
    </section>
  );
}
