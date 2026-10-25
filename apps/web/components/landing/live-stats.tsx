"use client";
import { StatPill } from "@/components/common";
import { usePoolStats } from "@/lib/client/hooks";
import { formatPct, formatStroops } from "@/lib/format";

export function LiveStats() {
  const { data, error, loading } = usePoolStats(20_000);
  const dash = error && !data ? "—" : "…";
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatPill label="Pool TVL" value={data ? formatStroops(data.tvl, { whole: true }) : dash} loading={loading && !data} hint="senior + first-loss" />
      <StatPill
        label="Senior APY"
        value={data ? formatPct(data.apy.projectedSenior) : dash}
        loading={loading && !data}
        hint={data ? `projected · target ${formatPct(data.apy.target, 0)}` : "projected"}
      />
      <StatPill label="Active notes" value={data ? data.notes.active.toLocaleString("en-GB") : dash} loading={loading && !data} hint={data ? `${data.notes.total} minted in total` : "on-chain"} />
      <StatPill label="Total advanced" value={data ? formatStroops(data.totalAdvanced, { whole: true }) : dash} loading={loading && !data} hint="spent by card on credit" />
    </div>
  );
}
