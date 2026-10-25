"use client";
import type { PoolStatsResponse } from "@/lib/api-types";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { formatBps, formatPct, formatStroops } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PoolHealth({ data }: { data: PoolStatsResponse | null }) {
  if (!data) {
    return (
      <Card className="p-5 sm:p-6">
        <p className="eyebrow">Pool health</p>
        <div className="mt-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      </Card>
    );
  }
  const s = data.stats;
  const leverage = s.leverageX100 / 100;
  const cap = s.params.maxLeverage;
  const leveragePct = cap > 0 ? Math.min(100, (leverage / cap) * 100) : 0;
  const utilPct = Math.min(100, s.utilizationBps / 100);

  return (
    <Card className="p-5 sm:p-6">
      <p className="eyebrow">Pool health</p>

      <dl className="mt-3 divide-y divide-line text-sm">
        <Row label="Total value locked" value={formatStroops(data.tvl)} strong />
        <Row label="Senior assets (investors)" value={formatStroops(s.seniorAssets)} />
        <Row
          label="First-loss assets (explorador)"
          value={formatStroops(s.juniorAssets)}
          hint={`coverage ${formatPct(data.coverage, 1)} of the pool`}
        />
        <Row label="Outstanding debt" value={formatStroops(s.totalDebt)} hint={`${formatStroops(s.totalPrincipal)} principal`} />
        <Row label="Idle liquidity" value={formatStroops(s.lendable)} hint="cash available to lend or withdraw" />
      </dl>

      <div className="mt-4 space-y-4">
        <Meter
          label="Utilization"
          value={formatBps(s.utilizationBps, 1)}
          pct={utilPct}
          help="Share of the pool's assets currently lent to agents."
        />
        <Meter
          label="Leverage (debt ÷ first-loss)"
          value={`${leverage.toFixed(2)}× of ${cap}× cap`}
          pct={leveragePct}
          warn={leveragePct >= 80}
          help={`Total debt can never exceed ${cap}× explorador's first-loss capital. Headroom: ${formatStroops(s.leverageHeadroom, { whole: true })}.`}
        />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Mini label="Target APY" value={formatPct(data.apy.target, 0)} />
        <Mini label="Projected" value={formatPct(data.apy.projectedSenior)} />
        <Mini label="7-day trailing" value={data.apy.trailing7d === null ? "—" : formatPct(data.apy.trailing7d)} />
      </div>

      <dl className="mt-4 divide-y divide-line border-t border-line text-sm">
        <Row label="Protocol fees accrued" value={formatStroops(s.feesAccrued)} />
        <Row label="Total written off" value={formatStroops(s.writtenOffTotal)} />
        <Row label="Agent APR" value={formatBps(s.params.agentAprBps, 0)} hint={`protocol fee ${formatBps(s.params.protocolFeeBps, 0)} of interest`} />
      </dl>

      <div className="mt-4">
        <p className="text-xs font-semibold text-muted">Notes by status</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
          <Chip className="bg-primary-faint text-primary ring-primary/20">{data.notes.active} active</Chip>
          <Chip className="bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300">{data.notes.settled} settled</Chip>
          <Chip className="bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200">{data.notes.cancelled} cancelled</Chip>
          <Chip className="bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300">{data.notes.writtenOff} written off</Chip>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">
        <span className={cn("tabular-nums", strong ? "text-base font-bold" : "font-semibold")}>{value}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

function Meter({ label, value, pct, help, warn }: { label: string; value: string; pct: number; help: string; warn?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <Tooltip content={help}>
          <span className="cursor-help text-muted underline decoration-dotted underline-offset-4">{label}</span>
        </Tooltip>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <Progress value={pct} className="mt-1.5" indicatorClassName={warn ? "bg-amber-500" : undefined} aria-label={label} />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-warm px-3 py-2.5">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-0.5 font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2.5 py-1 ring-1", className)}>{children}</span>;
}
