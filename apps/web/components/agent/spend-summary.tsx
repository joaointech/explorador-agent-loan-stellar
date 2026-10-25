"use client";

import { CreditCard } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/typography";
import { useProtocolNow } from "@/components/ui/use-now";
import { formatBps, formatEur } from "@/lib/format";

import { canTick, formatEurPrecise, liveDebt } from "./interest";
import { PurchaseSheet } from "./purchase-sheet";
import { cardState, spendable, type Overview } from "./state";

function Row({ label, hint, value }: { label: ReactNode; hint?: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="min-w-0">
        <span className="block text-sm font-semibold text-heading">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>}
      </dt>
      <dd className="shrink-0 text-right text-base font-semibold text-heading tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * "Available to spend" (card balance + borrowable now − pending holds) with the
 * breakdown, debt and interest ticking live from the borrow index (spec §5.2),
 * and the Simulate purchase button.
 */
export function SpendSummary({ data }: { data: Overview }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const now = useProtocolNow(data.rates.protocolNow, data.rates.fetchedAtMs);
  const position = data.position;
  const live = position ? liveDebt(position, data.rates, now) : null;
  const total = spendable(data);
  const holds = BigInt(data.pendingHolds ?? "0");
  const card = cardState(data);
  const hasLines = (position?.lines.length ?? 0) > 0;
  const apr = formatBps(data.rates.agentAprBps);
  // Agents whose deals all settled or fell through aren't waiting for their *first* note.
  const creditHint = position?.blocked
    ? "Blocked after a write-off: no new credit."
    : hasLines
      ? "50% of your commission on active deals, minus debt."
      : data.deals.length > 0
        ? "Opens again when explorador mints your next CPCV Note."
        : "Opens when explorador mints your first CPCV Note.";

  const disabledReason =
    position === null
      ? "Your balances are loading from Stellar."
      : card === "inactive"
        ? "Activate your card to start spending."
        : card === "paused"
          ? "Your card is paused. Resume it in Settings."
          : card === "none"
            ? "Your card isn't issued yet."
            : null;

  return (
    <Card radius="3xl" padding="md">
      <Eyebrow>Available to spend</Eyebrow>
      <p className="mt-2 text-[2.6rem] leading-none font-bold tracking-tight text-heading sm:text-5xl" aria-live="polite">
        {position ? <Amount value={total} subtleCents /> : <span className="text-subtle">—</span>}
      </p>
      {holds > 0n && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="blue" dot pulse>
            On hold
          </Badge>
          {formatEur(holds)} approved, recording on Stellar
        </p>
      )}

      <dl className="mt-4 divide-y divide-line border-t border-line">
        <Row label="Card balance" hint="Paid out by settled deals. Spent first." value={position ? <Amount value={position.cardBalance} /> : "—"} />
        <Row
          label="Credit available"
          hint={creditHint}
          value={position ? <Amount value={position.borrowableNow} /> : "—"}
        />
        <Row
          label="Debt"
          hint={
            live && live.totalDebt > 0n ? (
              <>
                {formatEur(live.totalPrincipal)} principal +{" "}
                <span className="font-medium text-fg tabular-nums" title={canTick(data.rates) ? "Ticking live from the pool's borrow index" : undefined}>
                  {formatEurPrecise(live.interest)}
                </span>{" "}
                interest · {apr} APR
              </>
            ) : (
              `You only borrow, at ${apr} APR, once your card balance runs out.`
            )
          }
          value={live ? <Amount value={live.totalDebt} /> : "—"}
        />
      </dl>

      <Button className="mt-4" fullWidth size="lg" icon={<CreditCard aria-hidden className="size-5" />} disabled={disabledReason !== null} onClick={() => setSheetOpen(true)}>
        Simulate purchase
      </Button>
      {disabledReason && <p className="mt-2 text-center text-xs text-muted">{disabledReason}</p>}

      <PurchaseSheet open={sheetOpen} onOpenChange={setSheetOpen} spendableNow={total} />
    </Card>
  );
}
