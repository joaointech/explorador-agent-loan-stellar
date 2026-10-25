"use client";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SnapshotPoint, SnapshotsResponse } from "@/lib/api-types";
import { EmptyState, ErrorNote } from "@/components/common";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePoll } from "@/lib/client/hooks";
import { formatEur, formatProtocolDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const axisTick = { fill: "var(--muted)", fontSize: 11 };
const eurShort = (v: number) => (Math.abs(v) >= 1000 ? `€${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : `€${v.toFixed(0)}`);

export function PoolCharts() {
  const [range, setRange] = React.useState<RangeKey>("30d");
  const { data, error, loading } = usePoll<SnapshotsResponse>(`/api/pool/snapshots?range=${range}`, 60_000);
  const points = data?.points ?? [];

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Pool history</h2>
        <div role="radiogroup" aria-label="Time range" className="inline-flex rounded-xl border border-line bg-surface p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="radio"
              aria-checked={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                range === r.key ? "bg-primary text-white" : "text-muted hover:text-ink",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {error && !data && <ErrorNote className="mt-3">Could not load the pool history: {error.message}</ErrorNote>}
      <div className={cn("mt-3 grid gap-4 lg:grid-cols-2", loading && data && "opacity-60 transition-opacity")}>
        <ChartCard title="Share price" subtitle="tEURC per eaSR share">
          {!data && loading ? <Skeleton className="h-56" /> : points.length < 2 ? <NoData /> : <SharePriceChart points={points} />}
        </ChartCard>
        <ChartCard
          title="TVL vs outstanding debt"
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-3">
              <LegendKey color="var(--chart-1)" label="TVL" />
              <LegendKey color="var(--chart-2)" label="Debt" />
            </span>
          }
        >
          {!data && loading ? <Skeleton className="h-56" /> : points.length < 2 ? <NoData /> : <TvlDebtChart points={points} />}
        </ChartCard>
      </div>
      {points.length > 0 && <DataTable points={points} />}
    </section>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="font-bold">{title}</h3>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
      {children}
    </Card>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-0.5 w-4 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function NoData() {
  return <EmptyState title="Not enough history yet" className="h-56">Snapshots are recorded as the pool changes.</EmptyState>;
}

function TooltipBox({ label, rows }: { label: string; rows: { color: string; name: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-muted">{label}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
          <span className="font-bold tabular-nums text-ink">{r.value}</span>
          <span className="text-muted">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

function SharePriceChart({ points }: { points: SnapshotPoint[] }) {
  const min = Math.min(...points.map((p) => p.sharePrice));
  const max = Math.max(...points.map((p) => p.sharePrice));
  const pad = Math.max((max - min) * 0.15, 0.0005);
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => formatProtocolDate(t).replace(/ \d{4}$/, "")}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tickFormatter={(v: number) => v.toFixed(4)}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  label={formatProtocolDate(Number(label))}
                  rows={[{ color: "var(--chart-1)", name: "share price", value: Number(payload[0].value).toFixed(6) }]}
                />
              ) : null
            }
          />
          <Line type="monotone" dataKey="sharePrice" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TvlDebtChart({ points }: { points: SnapshotPoint[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="tvlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="debtFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => formatProtocolDate(t).replace(/ \d{4}$/, "")}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis tickFormatter={eurShort} tick={axisTick} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as SnapshotPoint;
              return (
                <TooltipBox
                  label={formatProtocolDate(Number(label))}
                  rows={[
                    { color: "var(--chart-1)", name: "TVL", value: formatEur(p.tvlEur, { whole: true }) },
                    { color: "var(--chart-2)", name: "debt", value: formatEur(p.debtEur, { whole: true }) },
                  ]}
                />
              );
            }}
          />
          <Area type="monotone" dataKey="tvlEur" name="TVL" stroke="var(--chart-1)" strokeWidth={2} fill="url(#tvlFill)" isAnimationActive={false} />
          <Area type="monotone" dataKey="debtEur" name="Debt" stroke="var(--chart-2)" strokeWidth={2} fill="url(#debtFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DataTable({ points }: { points: SnapshotPoint[] }) {
  const rows = points.slice(-30).reverse();
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">View data as a table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line">
        <table className="w-full text-left text-xs tabular-nums">
          <thead className="sticky top-0 bg-warm text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Protocol date</th>
              <th className="px-3 py-2 text-right font-semibold">Share price</th>
              <th className="px-3 py-2 text-right font-semibold">TVL</th>
              <th className="px-3 py-2 text-right font-semibold">Debt</th>
              <th className="px-3 py-2 text-right font-semibold">Senior</th>
              <th className="px-3 py-2 text-right font-semibold">Junior</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={`${p.t}-${p.realT}`}>
                <td className="px-3 py-1.5">{formatProtocolDate(p.t)}</td>
                <td className="px-3 py-1.5 text-right">{p.sharePrice.toFixed(6)}</td>
                <td className="px-3 py-1.5 text-right">{formatEur(p.tvlEur, { whole: true })}</td>
                <td className="px-3 py-1.5 text-right">{formatEur(p.debtEur, { whole: true })}</td>
                <td className="px-3 py-1.5 text-right">{formatEur(p.seniorEur, { whole: true })}</td>
                <td className="px-3 py-1.5 text-right">{formatEur(p.juniorEur, { whole: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
