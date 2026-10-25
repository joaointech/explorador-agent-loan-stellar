"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronDown, FilePlus2 } from "lucide-react";
import type { AdminCpcvDto, AdminCpcvListResponse, TxResponse } from "@/lib/api-types";
import { DealStatusBadge, EmptyState, ErrorNote, OverdueBadge, TxLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiPost } from "@/lib/client/api";
import type { PollState } from "@/lib/client/hooks";
import { formatCents, formatDay, formatStroops, relativeDays } from "@/lib/format";
import { cn } from "@/lib/utils";

type Pending = { kind: "settle" | "cancel"; cpcv: AdminCpcvDto } | null;

export function CpcvTable({
  state,
  today,
  onChanged,
  onNew,
}: {
  state: PollState<AdminCpcvListResponse>;
  today: number | null;
  onChanged: () => void;
  onNew: () => void;
}) {
  const [pending, setPending] = React.useState<Pending>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [lastTx, setLastTx] = React.useState<{ id: string; kind: string; hash: string } | null>(null);
  const rows = state.data?.cpcvs ?? null;

  async function confirm() {
    if (!pending) return;
    const r = await apiPost<TxResponse>(`/api/admin/cpcv/${pending.cpcv.id}/${pending.kind}`);
    setLastTx({ id: pending.cpcv.id, kind: pending.kind, hash: r.txHash });
    onChanged();
  }

  if (!rows) {
    return state.error ? (
      <ErrorNote>Could not load CPCVs: {state.error.message}</ErrorNote>
    ) : (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState title="No CPCVs yet">
        <Button size="sm" className="mt-3" onClick={onNew}>
          <FilePlus2 /> Create the first one
        </Button>
      </EmptyState>
    );
  }

  return (
    <>
      {lastTx && (
        <p className="mb-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          {lastTx.kind === "settle" ? "Escritura confirmed — deal settled." : "Deal cancelled — the agent's debt is now carried."}{" "}
          <TxLink hash={lastTx.hash} label="View transaction" />
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-line bg-warm text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Agent</th>
              <th className="px-4 py-3 font-semibold">Property</th>
              <th className="px-4 py-3 text-right font-semibold">Total commission</th>
              <th className="px-4 py-3 text-right font-semibold">Debt</th>
              <th className="px-4 py-3 font-semibold">Escritura</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Note</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((c) => (
              <React.Fragment key={c.id}>
                <tr className="align-top">
                  <td className="px-4 py-3">
                    <span className="block font-semibold">{c.agentName ?? c.agentEmail}</span>
                    <span className="block text-xs text-muted">{c.agentEmail}</span>
                  </td>
                  <td className="max-w-[240px] px-4 py-3">
                    <button
                      className="flex w-full items-start gap-1 text-left hover:text-primary"
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                      aria-expanded={open === c.id}
                    >
                      <span className="line-clamp-2">{c.pii.propertyAddress}</span>
                      <ChevronDown className={cn("mt-0.5 size-4 shrink-0 transition-transform", open === c.id && "rotate-180")} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatStroops(c.totalCommission)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.debt === null ? "—" : formatStroops(c.debt)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="block tabular-nums">{formatDay(c.escrituraDay)}</span>
                    {today !== null && c.status === "MINTED" && <span className="text-xs text-muted">{relativeDays(c.escrituraDay, today)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      <DealStatusBadge status={c.status} />
                      {c.overdue && <OverdueBadge />}
                    </span>
                    {c.error && <span className="mt-1 block max-w-[200px] text-xs text-red-600">{c.error}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {c.noteId !== null ? (
                      <Link href={`/registry/${c.noteId}`} className="font-bold text-primary hover:underline">
                        #{c.noteId}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {c.status === "MINTED" && (
                        <>
                          <Button size="xs" variant="success" onClick={() => setPending({ kind: "settle", cpcv: c })}>
                            Confirm escritura
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => setPending({ kind: "cancel", cpcv: c })}>
                            Cancel (buyer withdrew)
                          </Button>
                        </>
                      )}
                      {c.noteId !== null && (
                        <Button size="xs" variant="ghost" asChild>
                          <Link href={`/registry/${c.noteId}`}>View proof</Link>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                {open === c.id && (
                  <tr className="bg-warm/60">
                    <td colSpan={8} className="px-4 py-3">
                      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                        <Pii label="Buyer" value={`${c.pii.buyerName} · NIF ${c.pii.buyerNif}`} />
                        <Pii label="Seller" value={`${c.pii.sellerName} · NIF ${c.pii.sellerNif}`} />
                        <Pii label="Sale price · rate" value={`${formatCents(c.pii.salePriceCents)} · ${(c.pii.commissionRateBps / 100).toFixed(2)}%`} />
                        <Pii label="CPCV → escritura" value={`${c.pii.cpcvDate} → ${c.pii.escrituraDate}`} />
                        <Pii label="Agent commission" value={formatStroops(c.agentCommission)} />
                        <Pii label="Credit limit" value={formatStroops(c.creditLimit)} />
                        <Pii label="Mint tx" value={<TxLink hash={c.mintTxHash} />} />
                        <Pii label={c.settleTxHash ? "Settle tx" : "Cancel tx"} value={<TxLink hash={c.settleTxHash ?? c.cancelTxHash} />} />
                      </dl>
                      <p className="mt-2 text-[11px] text-muted">Decrypted for explorador staff only — none of this is on-chain.</p>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === "settle" ? "Confirm the escritura?" : "Cancel this deal?"}
        confirmLabel={pending?.kind === "settle" ? "Confirm escritura" : "Cancel deal"}
        confirmVariant={pending?.kind === "settle" ? "success" : "danger"}
        onConfirm={confirm}
        description={
          pending &&
          (pending.kind === "settle" ? (
            <>
              The treasury pays the total commission of <strong>{formatStroops(pending.cpcv.totalCommission)}</strong> into the pool. It repays
              the note&apos;s debt and any carried debt, credits the rest of the agent&apos;s half to their card, and adds explorador&apos;s half to
              the first-loss tranche.
            </>
          ) : (
            <>
              The buyer walked away. explorador receives nothing; the agent&apos;s current debt on this note
              {pending.cpcv.debt ? ` (${formatStroops(pending.cpcv.debt)})` : ""} moves to their carried debt with a 180-day grace period.
            </>
          ))
        }
      />
    </>
  );
}

function Pii({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}
