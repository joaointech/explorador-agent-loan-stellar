"use client";

import { Card } from "@/components/ui/card";
import { AreaChart, LineChart } from "@/components/ui/charts";
import { cn } from "@/components/ui/cn";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eyebrow } from "@/components/ui/typography";
import { formatDate, formatDateTime, formatEur, formatShortDate, formatTime } from "@/lib/format";
import type { PoolSnapshotPoint, PoolSnapshotsResponse } from "@/lib/types/api";
import { DAY_SECS, stroopsToEur } from "@/lib/units";

import { SNAPSHOT_RANGES, type Remote, type SnapshotRange } from "./model";

const eurCompact = (v: number) => (Math.abs(v) >= 1_000_000 ? `€${(v / 1_000_000).toFixed(1)}m` : Math.abs(v) >= 1000 ? `€${Math.round(v / 1000)}k` : `€${Math.round(v)}`);
const eurFull = (v: number) => formatEur(v.toFixed(2), { unit: "eur" });

/** Decimals that make neighbouring share-price ticks differ: 4 for a month of growth, more when it barely moved. */
export function priceDecimals(points: Pick<PoolSnapshotPoint, "sharePrice">[]): number {
  if (points.length < 2) return 4;
  const prices = points.map((p) => p.sharePrice);
  const spread = Math.max(...prices) - Math.min(...prices);
  if (!(spread > 0)) return 4;
  return Math.min(8, Math.max(4, Math.ceil(-Math.log10(spread)) + 1));
}

/** X labels: dates for multi-day history, times (Lisbon) when everything happened within a day. */
export function timeFormatter(points: Pick<PoolSnapshotPoint, "t">[]): (t: unknown) => string {
  const span = points.length >= 2 ? points[points.length - 1].t - points[0].t : 0;
  return span < DAY_SECS ? (t) => formatTime(t as number) : (t) => formatShortDate(t as number);
}

/**
 * What the x axis covers: "25 Oct 2026, 09:12 – 16:40", "18 Oct – 25 Oct 2026",
 * or "25 Oct 2026 – 22 Feb 2027" across a new year (without years that one
 * would read backwards).
 */
export function spanLabel(points: Pick<PoolSnapshotPoint, "t">[]): string | null {
  if (points.length < 2) return null;
  const first = points[0].t;
  const last = points[points.length - 1].t;
  if (last - first < DAY_SECS) return `${formatDateTime(first)} – ${formatTime(last)}`;
  const [from, to] = [formatDate(first), formatDate(last)];
  return from.slice(-4) === to.slice(-4) ? `${formatShortDate(first)} – ${to}` : `${from} – ${to}`;
}

/** Share price over time and TVL vs outstanding debt (GET /api/pool/snapshots), with one range filter for both. */
export function PoolCharts({ snapshots, range, onRange }: { snapshots: Remote<PoolSnapshotsResponse>; range: SnapshotRange; onRange: (range: SnapshotRange) => void }) {
  const points = snapshots.data?.points ?? [];
  const priceData = points.map((p) => ({ t: p.t, price: p.sharePrice }));
  const tvlData = points.map((p) => ({ t: p.t, tvl: stroopsToEur(p.tvl), debt: stroopsToEur(p.debt) }));
  const digits = priceDecimals(points);
  const formatX = timeFormatter(points);
  const span = spanLabel(points);
  const loading = snapshots.loading && points.length === 0;
  const empty = snapshots.error
    ? `History is unavailable right now (${snapshots.error}).`
    : "Not enough history yet: the indexer records a snapshot whenever the pool changes.";
  // A single snapshot can't draw a line: show the empty state until there are two.
  const series = points.length >= 2;
  const stale = snapshots.loading && points.length > 0;

  return (
    <section aria-labelledby="pool-history" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow>History</Eyebrow>
          <h2 id="pool-history" className="mt-2 text-2xl font-bold tracking-tight text-heading sm:text-3xl">
            Share price and pool size
          </h2>
        </div>
        <Tabs value={range} onValueChange={(v) => onRange(v as SnapshotRange)}>
          <TabsList aria-label="Time range">
            {SNAPSHOT_RANGES.map((r) => (
              <TabsTrigger key={r.value} value={r.value}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className={cn("grid gap-4 lg:grid-cols-2", stale && "opacity-60 transition-opacity")} aria-busy={snapshots.loading || undefined}>
        <Card>
          <p className="text-sm font-semibold text-heading">Share price (eaSR)</p>
          <p className="mb-4 text-xs text-muted">
            tEURC per share; it rises as interest accrues.{span && ` ${span} (protocol clock).`}
          </p>
          <AreaChart
            title="eaSR share price over time"
            data={series ? priceData : []}
            x="t"
            xType="time"
            series={[{ key: "price", label: "Share price" }]}
            formatX={formatX}
            formatY={(v) => `€${v.toFixed(digits)}`}
            formatValue={(v) => `€${v.toFixed(Math.max(6, digits))}`}
            yDomain={["auto", "auto"]}
            loading={loading}
            empty={empty}
            height={240}
          />
        </Card>
        <Card>
          <p className="text-sm font-semibold text-heading">TVL vs outstanding debt</p>
          <p className="mb-4 text-xs text-muted">Senior + junior assets against what agents owe, in euros.</p>
          <LineChart
            title="Pool TVL and outstanding debt over time"
            data={series ? tvlData : []}
            x="t"
            xType="time"
            series={[
              { key: "tvl", label: "TVL" },
              { key: "debt", label: "Outstanding debt" },
            ]}
            formatX={formatX}
            formatY={eurCompact}
            formatValue={eurFull}
            loading={loading}
            empty={empty}
            height={240}
          />
        </Card>
      </div>
    </section>
  );
}
