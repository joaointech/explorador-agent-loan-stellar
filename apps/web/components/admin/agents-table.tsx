"use client";
import * as React from "react";
import Link from "next/link";
import type { AdminAgentDto, AdminAgentsResponse, TxResponse } from "@/lib/api-types";
import { Address, EmptyState, ErrorNote, TxLink } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { apiPost } from "@/lib/client/api";
import type { PollState } from "@/lib/client/hooks";
import { formatProtocolDate, formatStroops } from "@/lib/format";

export function AgentsTable({ state, protocolNow, onChanged }: { state: PollState<AdminAgentsResponse>; protocolNow: number | null; onChanged: () => void }) {
  const [target, setTarget] = React.useState<AdminAgentDto | null>(null);
  const [lastTx, setLastTx] = React.useState<string | null>(null);
  const rows = state.data?.agents ?? null;

  if (!rows) {
    return state.error ? (
      <ErrorNote>Could not load agents: {state.error.message}</ErrorNote>
    ) : (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <EmptyState title="No agents yet">Agents appear once they sign in with their email.</EmptyState>;

  return (
    <>
      {lastTx && (
        <p className="mb-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          Carried debt written off against the first-loss tranche. <TxLink hash={lastTx} label="View transaction" />
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-line bg-warm text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Agent</th>
              <th className="px-4 py-3 font-semibold">Smart account</th>
              <th className="px-4 py-3 font-semibold">Card</th>
              <th className="px-4 py-3 font-semibold">Notes</th>
              <th className="px-4 py-3 text-right font-semibold">Debt</th>
              <th className="px-4 py-3 text-right font-semibold">Carried debt</th>
              <th className="px-4 py-3 text-right font-semibold">Card balance</th>
              <th className="px-4 py-3 font-semibold">Grace deadline</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((a) => {
              const days = a.graceDeadline !== null && protocolNow !== null ? Math.ceil((a.graceDeadline - protocolNow) / 86_400) : null;
              return (
                <tr key={a.userId} className="align-top">
                  <td className="px-4 py-3">
                    <span className="block font-semibold">{a.displayName ?? a.email}</span>
                    <span className="block text-xs text-muted">{a.email}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {a.signerKind === "demo-ed25519" && <Badge tone="slate">demo signer</Badge>}
                      {a.blocked && <Badge tone="red">blocked</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Address value={a.smartAccount} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {a.cardLast4 ? (
                      <>
                        <span className="font-mono">•••• {a.cardLast4}</span>
                        <span className="block text-xs text-muted">{a.cardEnabled ? "active" : "not activated"}</span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.noteIds.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {a.noteIds.map((id) => (
                          <Link key={id} href={`/registry/${id}`} className="font-semibold text-primary hover:underline">
                            #{id}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatStroops(a.debt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{BigInt(a.carriedDebt) > 0n ? <span className="font-semibold text-amber-700 dark:text-amber-300">{formatStroops(a.carriedDebt)}</span> : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatStroops(a.cardBalance)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {a.graceDeadline !== null ? (
                      <>
                        <span className="block tabular-nums">{formatProtocolDate(a.graceDeadline)}</span>
                        {days !== null && (
                          <span className={days <= 0 ? "text-xs font-semibold text-red-600" : "text-xs text-muted"}>
                            {days <= 0 ? "passed" : `${days} days left`}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.canWriteOff ? (
                      <Button size="xs" variant="danger" onClick={() => setTarget(a)}>
                        Write off
                      </Button>
                    ) : (
                      <Tooltip content={BigInt(a.carriedDebt) > 0n ? "Available after the grace deadline" : "No carried debt"}>
                        <span tabIndex={0}>
                          <Button size="xs" variant="outline" disabled>
                            Write off
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Write off this carried debt?"
        confirmLabel="Write off"
        confirmVariant="danger"
        onConfirm={async () => {
          if (!target) return;
          const r = await apiPost<TxResponse>(`/api/admin/agents/${target.userId}/write-off`);
          setLastTx(r.txHash);
          onChanged();
        }}
        description={
          target && (
            <>
              <strong>{formatStroops(target.carriedDebt)}</strong> owed by {target.email} is removed from the book. The loss is taken from the
              first-loss tranche first, then senior. The agent is blocked from new credit.
            </>
          )
        }
      />
    </>
  );
}
