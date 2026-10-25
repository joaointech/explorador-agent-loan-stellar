"use client";

import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/layout";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

import { InvestHero } from "./invest-hero";
import { derivePosition, type InvestActions, type InvestModel } from "./model";
import { ConfigErrorNotice, NotDeployedNotice } from "./notices";
import { PoolCharts } from "./pool-charts";
import { PoolHealth } from "./pool-health";
import { PositionCard } from "./position-card";
import { VaultPanel } from "./vault-panel";
import { WalletCard } from "./wallet-card";
import { YieldExplainer } from "./yield-explainer";

function LoadingGrid() {
  return (
    <div aria-busy className="grid gap-6 lg:grid-cols-12">
      <Card padding="lg" className="flex flex-col gap-4 lg:col-span-7">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-48" />
        <SkeletonText lines={4} />
      </Card>
      <Card padding="lg" className="flex flex-col gap-4 lg:col-span-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </Card>
    </div>
  );
}

/**
 * The /invest dashboard (spec §10.2), rendered from a view model: live data
 * in InvestDashboard, fixtures in /invest/preview and tests.
 *
 * Phones: wallet → position → deposit/withdraw → pool health → charts →
 * explainer. From lg: position on the left, wallet and the vault panel on the right.
 */
export function InvestView({ model, actions }: { model: InvestModel; actions: InvestActions }) {
  const { deployment, wallet, stats, snapshots, investor, live, range } = model;
  const deployed = deployment.status === "ready";
  const explorerBase = deployed ? deployment.deployment.explorerBase : undefined;
  const connected = wallet.status === "connected";
  const position = derivePosition(investor.data, live.data, stats.data);
  const params = stats.data?.stats.params;
  const positionError = live.error ?? investor.error;

  return (
    <>
      <InvestHero stats={stats} showStats={deployed || deployment.status === "loading"} loading={deployment.status === "loading"} />
      <Container className="flex flex-col gap-12 py-8 sm:gap-16 sm:py-12">
        {(deployment.status !== "ready" && deployment.status !== "loading") && (
          <div className="-mb-4 sm:-mb-8">
            {deployment.status === "error" ? <ConfigErrorNotice message={deployment.message} onRetry={actions.retry} /> : <NotDeployedNotice />}
          </div>
        )}

        {deployment.status === "loading" ? (
          <LoadingGrid />
        ) : (
          <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
            <WalletCard
              wallet={wallet}
              position={position}
              liveLoading={live.loading}
              deployed={deployed}
              explorerBase={explorerBase}
              actions={actions}
              className="lg:col-span-5 lg:col-start-8 lg:row-start-1"
            />
            <PositionCard
              connected={connected && deployed}
              loading={live.loading || investor.loading}
              position={position}
              explorerBase={explorerBase}
              error={positionError}
              onRetry={actions.retry}
              className="lg:col-span-7 lg:col-start-1 lg:row-span-2 lg:row-start-1"
            />
            <VaultPanel
              wallet={wallet}
              position={position}
              stats={stats.data}
              deployed={deployed}
              explorerBase={explorerBase}
              actions={actions}
              className="lg:col-span-5 lg:col-start-8 lg:row-start-2"
            />
          </div>
        )}

        {deployed && <PoolHealth stats={stats} onRetry={actions.retry} />}
        {deployed && <PoolCharts snapshots={snapshots} range={range} onRange={actions.setRange} />}
        <YieldExplainer params={params} gracePeriodSecs={params ? Number(params.gracePeriodSecs) : undefined} />
      </Container>
    </>
  );
}
