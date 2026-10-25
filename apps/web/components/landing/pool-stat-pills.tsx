"use client";

import { Coins, FileCheck, TrendingUp, Wallet } from "lucide-react";

import { useApiResource } from "@/components/registry/use-api-resource";
import { cn } from "@/components/ui/cn";
import { StatPill } from "@/components/ui/stat-pill";
import { EMPTY_VALUE } from "@/lib/format";
import type { PoolStatsResponse } from "@/lib/types/api";

import { poolStatValues, type PoolStatValues } from "./pool-stat-values";

function values(data: PoolStatsResponse | undefined): PoolStatValues | null {
  if (!data) return null;
  try {
    return poolStatValues(data);
  } catch {
    return null;
  }
}

/**
 * Live pool numbers for the landing hero (spec §10.2): TVL, projected senior
 * APY, active notes and total advanced, from GET /api/pool/stats (refreshed
 * every minute while the tab is visible). Skeletons while loading; an em dash
 * and a one-line note when the pool can't be read.
 */
export function PoolStatPills({ className }: { className?: string }) {
  const stats = useApiResource<PoolStatsResponse>("/api/pool/stats", { refreshMs: 60_000 });
  const v = values(stats.data);
  const loading = stats.status === "loading";
  const failed = !loading && v === null;
  const show = (pick: (x: PoolStatValues) => string) => (v ? pick(v) : EMPTY_VALUE);

  return (
    <div className={className} aria-busy={loading || undefined}>
      <h2 className="sr-only">Live pool numbers</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill variant="glass" icon={<Coins />} label="Pool TVL" value={show((x) => x.tvl)} hint="Senior + first-loss" loading={loading} />
        <StatPill
          variant="glass"
          icon={<TrendingUp />}
          label="Senior APY"
          value={show((x) => x.seniorApy)}
          hint={v ? `Projected · target ${v.seniorTarget}` : "Projected"}
          tone="primary"
          loading={loading}
        />
        <StatPill variant="glass" icon={<FileCheck />} label="Active notes" value={show((x) => x.activeNotes)} hint="CPCV Notes on-chain" loading={loading} />
        <StatPill variant="glass" icon={<Wallet />} label="Total advanced" value={show((x) => x.totalAdvanced)} hint="Spent by card on credit" loading={loading} />
      </div>
      <p role="status" className={cn("mt-3 text-xs text-muted", !failed && "sr-only")}>
        {failed ? "Live pool numbers are unavailable right now." : loading ? "Loading live pool numbers…" : ""}
      </p>
    </div>
  );
}
