import { ArrowDownToLine, Ban, CircleCheck, CircleX, CreditCard, Landmark, LoaderCircle, Undo2 } from "lucide-react";
import type { ActivityItem } from "@/lib/api-types";
import { EmptyState, TxLink } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { formatCents, formatDateTime, formatStroops } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toBig } from "./money";

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <EmptyState title="No activity yet">Card purchases and settlements show up here.</EmptyState>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {items.map((it, i) => (
        <li key={`${it.kind}-${"id" in it ? it.id : it.txHash}-${i}`} className="flex gap-3 px-4 py-3.5">
          <ActivityIcon item={it} />
          <div className="min-w-0 flex-1">
            <ActivityBody item={it} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityIcon({ item }: { item: ActivityItem }) {
  const base = "flex size-9 shrink-0 items-center justify-center rounded-xl";
  switch (item.kind) {
    case "card":
      return (
        <span className={cn(base, item.decision === "DECLINED" ? "bg-red-50 text-red-600 dark:bg-red-500/10" : "bg-primary-soft text-primary")}>
          <CreditCard className="size-4" />
        </span>
      );
    case "settlement":
      return (
        <span className={cn(base, "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10")}>
          <Landmark className="size-4" />
        </span>
      );
    case "cancellation":
      return (
        <span className={cn(base, "bg-amber-50 text-amber-600 dark:bg-amber-500/10")}>
          <Undo2 className="size-4" />
        </span>
      );
    case "writeoff":
      return (
        <span className={cn(base, "bg-red-50 text-red-600 dark:bg-red-500/10")}>
          <Ban className="size-4" />
        </span>
      );
    case "withdrawal":
      return (
        <span className={cn(base, "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300")}>
          <ArrowDownToLine className="size-4" />
        </span>
      );
  }
}

export function ChainStatusBadge({ status }: { status: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED" }) {
  if (status === "CONFIRMED")
    return (
      <Badge tone="emerald">
        <CircleCheck className="size-3" /> On-chain
      </Badge>
    );
  if (status === "FAILED")
    return (
      <Badge tone="red">
        <CircleX className="size-3" /> Unfunded
      </Badge>
    );
  return (
    <Badge tone="blue">
      <LoaderCircle className="size-3 animate-spin" /> Confirming
    </Badge>
  );
}

function ActivityBody({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case "card": {
      const fb = toBig(item.fromBalance);
      const fc = toBig(item.fromCredit);
      return (
        <>
          <div className="flex items-start justify-between gap-2">
            <span className="truncate font-semibold">{item.merchant}</span>
            <span className={cn("shrink-0 font-bold tabular-nums", item.decision === "DECLINED" && "text-muted line-through")}>
              −{formatCents(item.amountCents)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{formatDateTime(item.createdAt)}</span>
            {item.decision === "DECLINED" ? (
              <Badge tone="red">Declined{item.declineReason ? ` · ${humanReason(item.declineReason)}` : ""}</Badge>
            ) : (
              <>
                <ChainStatusBadge status={item.chainStatus} />
                {(item.fromBalance !== null || item.fromCredit !== null) && (
                  <span className="tabular-nums">
                    from balance {formatStroops(fb)} / on credit {formatStroops(fc)}
                  </span>
                )}
                {item.txHash && <TxLink hash={item.txHash} />}
              </>
            )}
          </div>
        </>
      );
    }
    case "settlement":
      return (
        <>
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">
              Deal #{item.noteId} settled: {formatStroops(item.agentPayout)} added
            </span>
            <span className="shrink-0 font-bold tabular-nums text-emerald-600">+{formatStroops(item.agentPayout)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
            <span>{formatDateTime(item.createdAt)}</span>
            {toBig(item.debtRepaid) > 0n && (
              <span className="tabular-nums">
                debt repaid {formatStroops(item.debtRepaid)} (incl. {formatStroops(item.interestPaid)} interest)
              </span>
            )}
            {toBig(item.carriedRepaid) > 0n && <span className="tabular-nums">carried debt repaid {formatStroops(item.carriedRepaid)}</span>}
            <TxLink hash={item.txHash} />
          </div>
        </>
      );
    case "cancellation":
      return (
        <>
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">Deal #{item.noteId} cancelled — buyer withdrew</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
            <span>{formatDateTime(item.createdAt)}</span>
            {toBig(item.debtCarried) > 0n && <span className="tabular-nums">{formatStroops(item.debtCarried)} carried to your account</span>}
            <TxLink hash={item.txHash} />
          </div>
        </>
      );
    case "writeoff":
      return (
        <>
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">Carried debt written off</span>
            <span className="shrink-0 font-bold tabular-nums">{formatStroops(item.amount)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
            <span>{formatDateTime(item.createdAt)}</span>
            <TxLink hash={item.txHash} />
          </div>
        </>
      );
    case "withdrawal":
      return (
        <>
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">Balance withdrawn to your account</span>
            <span className="shrink-0 font-bold tabular-nums">−{formatStroops(item.amount)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
            <span>{formatDateTime(item.createdAt)}</span>
            <TxLink hash={item.txHash} />
          </div>
        </>
      );
  }
}

export function humanReason(r: string): string {
  const map: Record<string, string> = {
    INSUFFICIENT_FUNDS: "insufficient funds",
    CARD_PAUSED: "card not activated",
    SUSPECTED_FRAUD: "unknown card",
  };
  return map[r] ?? r.toLowerCase().replace(/_/g, " ");
}
