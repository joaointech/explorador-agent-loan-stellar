import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, PiggyBank } from "lucide-react";

import { TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardRow } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { DateText } from "@/components/ui/date-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EMPTY_VALUE, formatSharePrice } from "@/lib/format";

import { formatEurLimit, formatShares } from "./format";
import type { PositionView } from "./model";

const START_STEPS = [
  { title: "Connect Freighter", text: "Your Stellar wallet, set to testnet." },
  { title: "Get test funds", text: "Test XLM for fees and 10,000 tEURC to invest." },
  { title: "Deposit", text: "tEURC goes into the senior vault; you receive eaSR shares." },
  { title: "Earn and withdraw", text: "The share price grows with agents' interest; withdraw up to the idle liquidity." },
];

function StartSteps() {
  return (
    <ol className="mt-5 grid gap-3 sm:grid-cols-2">
      {START_STEPS.map((step, i) => (
        <li key={step.title} className="flex gap-3 rounded-xl bg-card-muted p-3.5 ring-1 ring-line">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-sm font-bold text-primary-text ring-1 ring-primary/15">
            {i + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-heading">{step.title}</span>
            <span className="mt-0.5 block text-sm leading-relaxed text-muted">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function History({ position, explorerBase }: { position: PositionView; explorerBase?: string }) {
  if (position.history.length === 0) return null;
  const items = position.history.slice(0, 6);
  return (
    <div className="mt-6">
      <h4 className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">Your activity</h4>
      <ul className="mt-2 divide-y divide-line">
        {items.map((item) => {
          const deposit = item.type === "deposit";
          const Icon = deposit ? ArrowDownToLine : ArrowUpFromLine;
          return (
            <li key={`${item.txHash}-${item.type}`} className="flex items-center gap-3 py-2.5 text-sm">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full ring-1",
                  deposit ? "bg-primary-tint text-primary-text ring-primary/15" : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
                )}
              >
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-heading">{deposit ? "Deposit" : "Withdrawal"}</span>
                <span className="block text-xs text-muted">
                  <DateText value={item.at} /> · {formatShares(BigInt(item.shares))}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <Amount value={deposit ? item.assets : `-${item.assets}`} sign="exceptZero" className="font-semibold text-heading" />
                <TxLink hash={item.txHash} explorerBase={explorerBase} className="text-xs" />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Shares (eaSR), current value, deposited, earned and share price; the steps to start when not connected. */
export function PositionCard({
  connected,
  loading,
  position,
  explorerBase,
  error,
  onRetry,
  className,
}: {
  connected: boolean;
  loading: boolean;
  position: PositionView;
  explorerBase?: string;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  if (!connected) {
    return (
      <Card padding="lg" className={className}>
        <CardHeader
          eyebrow="Your position"
          title="Fund agents' advances, earn the interest"
          description="Agents borrow against signed CPCVs at 12% APR. Senior depositors are paid first, up to an 8% APY target, and explorador's first-loss tranche absorbs defaults before you do."
        />
        <StartSteps />
      </Card>
    );
  }

  if (loading && position.shares === null) {
    return (
      <Card padding="lg" aria-busy className={cn("flex flex-col gap-4", className)}>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-48" />
        <SkeletonText lines={4} />
      </Card>
    );
  }

  if (position.shares === null && error) {
    return (
      <Card padding="lg" className={className}>
        <CardHeader eyebrow="Your position" title="Senior vault (eaSR)" />
        <div role="alert" className="mt-5 flex flex-col items-start gap-3 rounded-xl bg-card-muted p-4 ring-1 ring-line">
          <p className="flex items-start gap-2 text-sm text-fg">
            <CircleAlert aria-hidden className="mt-0.5 size-[18px] shrink-0 text-red-500" />
            Your position couldn&apos;t load ({error}).
          </p>
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </Card>
    );
  }

  if (position.isEmpty) {
    return (
      <Card padding="lg" className={className}>
        <CardHeader eyebrow="Your position" title="Senior vault (eaSR)" />
        <EmptyState
          className="mt-5"
          icon={<PiggyBank />}
          title="No position yet"
          description="Deposit tEURC to receive eaSR shares. Their value grows as agents pay interest on their advances."
        />
        {error && <p className="mt-3 text-xs text-muted">Some figures couldn&apos;t load: {error}</p>}
      </Card>
    );
  }

  return (
    <Card padding="lg" className={className}>
      <CardHeader eyebrow="Your position" title="Senior vault (eaSR)" />
      <div className="mt-4">
        <p className="text-sm text-muted">Current value</p>
        <p className="mt-1 text-4xl font-bold tracking-tight text-heading sm:text-5xl">
          <Amount value={position.value} subtleCents />
        </p>
        {position.earned !== null && (
          <p className="mt-2 text-sm text-muted">
            <Amount value={position.earned} sign="exceptZero" tone="auto" className="font-semibold" /> earned so far
          </p>
        )}
      </div>
      <div className="mt-5">
        <CardRow label="Shares" value={formatShares(position.shares)} />
        <CardRow label="Share price" value={position.sharePriceScaled !== null ? `${formatSharePrice(position.sharePriceScaled, 6)} per eaSR` : EMPTY_VALUE} />
        <CardRow label="Deposited" value={<Amount value={position.deposited} />} />
        {position.withdrawn !== null && position.withdrawn > 0n && <CardRow label="Withdrawn" value={<Amount value={position.withdrawn} />} />}
        <CardRow label="Earned" value={<Amount value={position.earned} sign="exceptZero" tone="auto" />} />
        <CardRow label="Withdrawable now" value={formatEurLimit(position.maxWithdraw)} />
      </div>
      {error && <p className="mt-3 text-xs text-muted">Some figures couldn&apos;t load: {error}</p>}
      <History position={position} explorerBase={explorerBase} />
    </Card>
  );
}
