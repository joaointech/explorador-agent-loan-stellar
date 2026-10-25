"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { StatusBadge } from "@/components/ui/badge";
import { CardRow } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { DateText } from "@/components/ui/date-text";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { creditLimitOf, previewSettlement } from "@/lib/admin/commission";
import { formatBps, formatCents, formatDate, formatEur } from "@/lib/format";
import type { AdminCpcvActionResponse, AdminCpcvDetailResponse, AdminCpcvRow } from "@/lib/types/api";
import { DAY_SECS, PARAMS } from "@/lib/units";

import { postAdmin } from "./api";
import { ConfirmDialog } from "./confirm-dialog";
import { useAdminResource } from "./use-admin-resource";

const noteLabel = (row: AdminCpcvRow) => (row.noteId !== null ? `#${row.noteId}` : "");

function Rows({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line px-4 py-1">{children}</div>;
}

function useDetail(id: string) {
  return useAdminResource<AdminCpcvDetailResponse>(`/api/admin/cpcv/${id}`);
}

function PreviewLoading() {
  return (
    <div aria-busy className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function SettlePreview({ row }: { row: AdminCpcvRow }) {
  const { data, loading } = useDetail(row.id);
  if (loading) return <PreviewLoading />;
  const agentCommission = BigInt(row.agentCommission);
  const exploradorCommission = BigInt(row.totalCommission) - agentCommission;
  const line = data?.line ?? null;
  const preview = line
    ? previewSettlement({ agentCommission, exploradorCommission, lineDebt: BigInt(line.debt), carriedDebt: BigInt(data?.agentPosition?.carriedDebt ?? "0") })
    : null;
  return (
    <div className="flex flex-col gap-3">
      <Rows>
        <CardRow label="Treasury pays the total commission" value={<Amount value={row.totalCommission} />} />
        {preview ? (
          <>
            <CardRow label={<>Debt repaid (incl. <Amount value={line!.interest} /> interest)</>} value={<Amount value={preview.debtRepaid} />} />
            {preview.carriedRepaid > 0n && <CardRow label="Carried debt from cancelled deals repaid" value={<Amount value={preview.carriedRepaid} />} />}
            <CardRow label="To the agent's card balance" value={<Amount value={preview.agentPayout} className="text-emerald-600 dark:text-emerald-400" />} />
          </>
        ) : (
          <CardRow label="Agent's half (debt and interest repaid first)" value={<Amount value={row.agentCommission} />} />
        )}
        <CardRow label="explorador's half → junior (first-loss) tranche" value={<Amount value={exploradorCommission} />} />
      </Rows>
      {preview && preview.shortfall > 0n && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          The debt is above the agent&apos;s half: <Amount value={preview.shortfall} /> becomes carried debt with a grace period.
        </p>
      )}
      {!preview && <p className="text-xs text-muted">Live debt unavailable: the contract computes the exact split when it settles.</p>}
    </div>
  );
}

function CancelPreview({ row }: { row: AdminCpcvRow }) {
  const { data, loading } = useDetail(row.id);
  if (loading) return <PreviewLoading />;
  const debt = data?.line ? BigInt(data.line.debt) : null;
  const balance = data?.agentPosition ? BigInt(data.agentPosition.cardBalance) : null;
  const existingDeadline = data?.agentPosition?.graceDeadline ?? null;
  const newDeadline = data?.clock ? data.clock.protocolNow + PARAMS.gracePeriodSecs : null;
  return (
    <Rows>
      <CardRow label="Debt moving to the agent's carried debt" value={debt !== null ? <Amount value={debt} /> : "—"} />
      {balance !== null && debt !== null && debt > 0n && (
        <CardRow label="Repaid at once from the agent's card balance" value={<Amount value={balance < debt ? balance : debt} />} />
      )}
      <CardRow
        label="Grace period (protocol clock)"
        value={
          existingDeadline !== null ? (
            <>
              running, until <DateText value={existingDeadline} />
            </>
          ) : newDeadline !== null ? (
            <>
              {PARAMS.gracePeriodSecs / DAY_SECS} days, until <DateText value={newDeadline} />
            </>
          ) : (
            `${PARAMS.gracePeriodSecs / DAY_SECS} days`
          )
        }
      />
      <CardRow label="explorador receives" value="Nothing" />
    </Rows>
  );
}

/** "Confirm escritura": advance_pool.settle (spec §4.5). */
export function SettleDialog({ row, onClose, onDone }: { row: AdminCpcvRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => !open && onClose()}
      title={row ? `Confirm the escritura of note ${noteLabel(row)}?` : "Confirm escritura"}
      description={row ? `${row.propertyAddress || "This deal"}. explorador's treasury pays the commission into the pool, which repays the agent's debt and interest first.` : undefined}
      confirmLabel="Confirm escritura"
      onConfirm={async () => {
        if (!row) return;
        const res = await postAdmin<AdminCpcvActionResponse>(`/api/admin/cpcv/${row.id}/settle`);
        toast.success(`Deal ${noteLabel(row)} settled`, {
          description: `${formatEur(row.totalCommission)} paid in; the agent's debt is repaid and the rest of their half is on their card balance.`,
          action: { label: "View transaction", href: res.explorerUrl },
        });
        onDone();
      }}
    >
      {row && <SettlePreview row={row} />}
    </ConfirmDialog>
  );
}

/** "Cancel (buyer withdrew)": advance_pool.cancel (spec §4.6). */
export function CancelDialog({ row, onClose, onDone }: { row: AdminCpcvRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => !open && onClose()}
      tone="danger"
      title={row ? `Cancel note ${noteLabel(row)}: the buyer withdrew?` : "Cancel deal"}
      description="The escritura will not happen. The note's credit line closes, its debt becomes the agent's carried debt (repaid first from their future settlements) and keeps accruing interest; after the grace period it can be written off."
      confirmLabel="Cancel the deal"
      onConfirm={async () => {
        if (!row) return;
        const res = await postAdmin<AdminCpcvActionResponse>(`/api/admin/cpcv/${row.id}/cancel`);
        toast.success(`Deal ${noteLabel(row)} cancelled`, {
          description: "Its debt is now carried by the agent and the grace period has started.",
          action: { label: "View transaction", href: res.explorerUrl },
        });
        onDone();
      }}
    >
      {row && <CancelPreview row={row} />}
    </ConfirmDialog>
  );
}

const SIGNAL_LABELS = [
  "agent_field",
  "total_commission_cents",
  "agent_commission_cents",
  "escritura_day",
  "commitment",
  "nullifier",
  "attester_ax",
  "attester_ay",
  "nullifier_secret_commitment",
];

function Hex({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      <span className="flex items-start gap-1">
        <code className="min-w-0 flex-1 font-mono text-xs break-all text-fg">{value || "—"}</code>
        {value && <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />}
      </span>
    </div>
  );
}

function DetailBody({ row }: { row: AdminCpcvRow }) {
  const { data, loading, error } = useDetail(row.id);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Private deal data" className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-heading">Deal (private, encrypted at rest)</h3>
        {row.piiUnavailable ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">The personal data of this CPCV can&apos;t be decrypted with this server&apos;s key.</p>
        ) : (
          <Rows>
            <CardRow label="Buyer" value={`${row.buyerName} · NIF ${row.buyerNif}`} />
            <CardRow label="Seller" value={`${row.sellerName} · NIF ${row.sellerNif}`} />
            <CardRow label="Property" value={row.propertyAddress} />
            <CardRow label="Sale price" value={formatCents(row.salePriceCents)} />
            <CardRow label="Commission rate" value={formatBps(row.commissionRateBps)} />
            <CardRow label="CPCV date" value={formatDate(row.cpcvDay)} />
          </Rows>
        )}
      </section>

      <section aria-label="Public deal data" className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-heading">On-chain (public)</h3>
        <Rows>
          <CardRow label="Status" value={<StatusBadge status={row.status} />} />
          <CardRow
            label="Note"
            value={
              row.noteId !== null ? (
                <Link href={`/registry/${row.noteId}`} className="inline-flex items-center gap-0.5 font-semibold text-primary-text hover:underline">
                  #{row.noteId} in the registry <ArrowUpRight aria-hidden className="size-3.5" />
                </Link>
              ) : (
                "Not minted"
              )
            }
          />
          <CardRow label="Total commission" value={<Amount value={row.totalCommission} />} />
          <CardRow label="Agent / explorador" value={<><Amount value={row.agentCommission} /> / <Amount value={BigInt(row.totalCommission) - BigInt(row.agentCommission)} /></>} />
          <CardRow label="Credit limit" value={<Amount value={creditLimitOf(BigInt(row.agentCommission))} />} />
          <CardRow label="Escritura" value={<DateText value={row.escrituraDay} />} />
          {row.mintTxHash && <CardRow label="Mint transaction" value={<TxLink hash={row.mintTxHash} />} />}
          {row.settleTxHash && <CardRow label="Settle transaction" value={<TxLink hash={row.settleTxHash} />} />}
          {row.cancelTxHash && <CardRow label="Cancel transaction" value={<TxLink hash={row.cancelTxHash} />} />}
        </Rows>
        {row.error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{row.error}</p>}
      </section>

      <section aria-label="Zero-knowledge proof" className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-heading">Zero-knowledge proof</h3>
        {loading ? (
          <PreviewLoading />
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
        ) : data ? (
          <>
            <div className="divide-y divide-line rounded-xl border border-line px-4">
              <Hex label="Commitment" value={data.commitment} />
              <Hex label="Nullifier" value={data.nullifier} />
            </div>
            {data.proof ? (
              <>
                <details className="rounded-xl border border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-heading">Public signals (circuit order)</summary>
                  <ol className="mt-3 flex flex-col gap-2">
                    {data.proof.publicSignals.map((signal, i) => (
                      <li key={SIGNAL_LABELS[i] ?? i} className="flex flex-col gap-0.5">
                        <span className="font-mono text-[11px] text-muted">
                          {i} · {SIGNAL_LABELS[i] ?? "signal"}
                        </span>
                        <code className="font-mono text-xs break-all text-fg">{signal}</code>
                      </li>
                    ))}
                  </ol>
                </details>
                <details className="rounded-xl border border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-heading">Proof (snarkjs, Groth16 / BN254)</summary>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-card-muted p-3 font-mono text-[11px] leading-relaxed text-fg">
                    {JSON.stringify(data.proof.proof, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <p className="text-sm text-muted">No proof stored (the pipeline stopped before proving finished).</p>
            )}
            {data.salt && (
              <details className="rounded-xl border border-line px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-heading">Commitment opening (for an auditor)</summary>
                <p className="mt-2 text-xs text-muted">
                  With the private data above and this salt, anyone can recompute the commitment: Poseidon(buyer NIF, seller NIF, sale price, rate, property hash, CPCV day, escritura day, salt).
                </p>
                <Hex label="Salt" value={data.salt} />
              </details>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

/** "View proof": the decrypted record, on-chain links, commitment/nullifier and the proof. */
export function CpcvDetailsDialog({ row, onClose }: { row: AdminCpcvRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()} size="lg" title={row ? `CPCV ${row.noteId !== null ? `· note #${row.noteId}` : ""}` : "CPCV"} description={row ? `${row.agent.email} · created ${formatDate(row.createdAt)}` : undefined}>
      {row && <DetailBody row={row} />}
    </Dialog>
  );
}
