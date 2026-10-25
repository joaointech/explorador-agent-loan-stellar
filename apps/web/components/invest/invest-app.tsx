"use client";
import type { InvestorResponse } from "@/lib/api-types";
import { PageHeader, StatPill } from "@/components/common";
import { usePoll, usePoolStats } from "@/lib/client/hooks";
import { formatPct, formatStroops } from "@/lib/format";
import { PoolCharts } from "./charts";
import { PoolHealth } from "./pool-health";
import { TradePanel } from "./trade-panel";
import { ConnectCard, NetworkWarning, PositionCard } from "./wallet-panel";
import { useFreighterWallet } from "./wallet";
import { YieldWaterfall } from "./yield-waterfall";

export function InvestApp() {
  const wallet = useFreighterWallet();
  const pool = usePoolStats(15_000);
  const investor = usePoll<InvestorResponse>(wallet.address ? `/api/investor/${wallet.address}` : null, 15_000);
  const p = pool.data;
  const canSign = !!wallet.address && (wallet.network?.isTestnet ?? true);

  function refreshAll() {
    void investor.refresh();
    void pool.refresh();
    // The indexer catches up a few seconds after the ledger closes.
    setTimeout(() => {
      void investor.refresh();
      void pool.refresh();
    }, 4000);
  }

  return (
    <>
      <PageHeader eyebrow="Invest · senior tranche" first="Earn agents' interest," second="protected by first-loss capital.">
        <p className="mt-3 max-w-2xl text-ink-soft">
          Deposit tEURC into the senior vault (SEP-56). Your shares grow as agents repay their advances with interest — explorador&apos;s junior
          tranche absorbs losses first.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatPill label="Pool TVL" value={p ? formatStroops(p.tvl, { whole: true }) : "…"} loading={!p} />
          <StatPill label="Senior APY" value={p ? formatPct(p.apy.projectedSenior) : "…"} hint={p ? `projected · target ${formatPct(p.apy.target, 0)}` : undefined} loading={!p} />
          <StatPill label="Share price" value={p ? p.stats.sharePrice.toFixed(6) : "…"} hint="tEURC per eaSR" loading={!p} />
          <StatPill label="First-loss cover" value={p ? formatPct(p.coverage, 1) : "…"} hint="junior ÷ pool" loading={!p} />
        </div>
      </PageHeader>

      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:py-10">
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <NetworkWarning wallet={wallet} />
            {wallet.address ? (
              <PositionCard wallet={wallet} investor={investor.data} loading={investor.loading} onChanged={refreshAll} />
            ) : (
              <ConnectCard wallet={wallet} />
            )}
            <TradePanel address={wallet.address} canSign={canSign} investor={investor.data} pool={p} onDone={refreshAll} />
          </div>
          <div className="lg:col-span-5">
            <PoolHealth data={p} />
          </div>
        </div>
        <PoolCharts />
        <YieldWaterfall />
      </div>
    </>
  );
}
