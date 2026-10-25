"use client";

import { ArrowDownToLine, CircleCheck, CircleX, Inbox, Store, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Address, TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { DateText } from "@/components/ui/date-text";
import { EmptyState } from "@/components/ui/empty-state";
import { formatEur } from "@/lib/format";
import type { ActivityItem } from "@/lib/types/api";

import { declineLabel, type Overview } from "./state";

/** Items shown before "Show all". */
const INITIAL_ITEMS = 6;

type Tone = "blue" | "emerald" | "amber" | "red" | "neutral";

const ICON_TONES: Record<Tone, string> = {
  blue: "bg-primary-tint text-primary-text ring-primary/15",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-600 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-red-50 text-red-600 ring-red-600/15 dark:bg-red-500/15 dark:text-red-300",
  neutral: "bg-slate-100 text-slate-500 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300",
};

/** One activity entry: icon, title + amount, real date-time, an optional detail line, then status and tx link. */
function Row({
  icon: Icon,
  tone,
  title,
  amount,
  at,
  detail,
  footer,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: ReactNode;
  amount?: ReactNode;
  at: string;
  detail?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <li className="flex gap-3 py-3.5">
      <span className={cn("mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full ring-1", ICON_TONES[tone])}>
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm leading-snug font-semibold text-heading">{title}</p>
          {amount && <div className="shrink-0 text-sm font-semibold">{amount}</div>}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          <DateText value={at} format="datetime" />
        </p>
        {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
        {footer && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">{footer}</div>}
      </div>
    </li>
  );
}

function CardRow({ item }: { item: Extract<ActivityItem, { kind: "card" }> }) {
  const amount = BigInt(item.amount);
  if (item.decision === "DECLINED") {
    return (
      <Row
        icon={CircleX}
        tone="red"
        title={item.merchant}
        amount={<Amount value={item.amount} tone="muted" className="line-through" />}
        at={item.at}
        detail={<span className="font-medium text-red-600 dark:text-red-400">Declined · {declineLabel(item.declineReason)}</span>}
      />
    );
  }
  const confirmed = item.chainStatus === "CONFIRMED";
  return (
    <Row
      icon={Store}
      tone={item.chainStatus === "FAILED" ? "amber" : "blue"}
      title={item.merchant}
      amount={amount < 0n ? <Amount value={-amount} sign="always" tone="positive" /> : <Amount value={-amount} className="text-heading" />}
      at={item.at}
      detail={confirmed && item.fromBalance !== null && item.fromCredit !== null ? `from balance ${formatEur(item.fromBalance)} / on credit ${formatEur(item.fromCredit)}` : undefined}
      footer={
        <>
          {item.chainStatus === "FAILED" ? (
            <Badge tone="amber" dot>
              Not recorded on-chain · covered by explorador
            </Badge>
          ) : !confirmed ? (
            <Badge tone="blue" dot pulse>
              Recording on Stellar
            </Badge>
          ) : null}
          {item.txHash && <TxLink hash={item.txHash} />}
        </>
      }
    />
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case "card":
      return <CardRow item={item} />;
    case "settlement":
      return (
        <Row
          icon={CircleCheck}
          tone="emerald"
          title={`Deal #${item.noteId} settled: ${formatEur(item.agentPayout)} added to your card balance`}
          amount={<Amount value={item.agentPayout} sign="always" tone="positive" />}
          at={item.at}
          detail={BigInt(item.debtRepaid) > 0n ? `Debt and interest repaid: ${formatEur(item.debtRepaid)}` : undefined}
          footer={<TxLink hash={item.txHash} />}
        />
      );
    case "cancellation":
      return (
        <Row
          icon={TriangleAlert}
          tone="amber"
          title={
            BigInt(item.debtCarried) > 0n
              ? `Deal #${item.noteId} cancelled: ${formatEur(item.debtCarried)} moved to carried debt`
              : `Deal #${item.noteId} cancelled: the buyer withdrew`
          }
          at={item.at}
          detail={
            item.graceDeadline !== null ? (
              <>
                Grace period until <DateText value={item.graceDeadline} />
              </>
            ) : undefined
          }
          footer={<TxLink hash={item.txHash} />}
        />
      );
    case "withdrawal":
      return (
        <Row
          icon={ArrowDownToLine}
          tone="neutral"
          title="Withdrawn to your account"
          amount={<Amount value={-BigInt(item.amount)} className="text-heading" />}
          at={item.at}
          detail={
            item.to ? (
              <span className="inline-flex items-center gap-1">
                to <Address address={item.to} copy={false} label="destination account" />
              </span>
            ) : undefined
          }
          footer={<TxLink hash={item.txHash} />}
        />
      );
  }
}

/** Card transactions (real timestamps), settlements, cancellations and withdrawals, newest first. */
export function ActivitySection({ data }: { data: Overview }) {
  const [expanded, setExpanded] = useState(false);
  const items = expanded ? data.activity : data.activity.slice(0, INITIAL_ITEMS);
  return (
    <Card radius="3xl" padding="md">
      <CardHeader titleAs="h2" title="Activity" description="Card purchases, settlements and withdrawals. Times in Lisbon." />
      {data.activity.length === 0 ? (
        <EmptyState className="mt-4" icon={<Inbox />} title="No activity yet" description="Your card purchases and deal settlements will show up here." />
      ) : (
        <>
          <ul className="mt-2 divide-y divide-line">
            {items.map((item) => (
              <ActivityRow key={`${item.kind}:${item.id}`} item={item} />
            ))}
          </ul>
          {data.activity.length > INITIAL_ITEMS && (
            <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? "Show less" : `Show all ${data.activity.length}`}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
