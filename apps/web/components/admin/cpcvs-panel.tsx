"use client";

import { FileSearch, Inbox, RotateCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Address, TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DateText } from "@/components/ui/date-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/typography";
import { formatRelativeDays } from "@/lib/format";
import type { AdminCpcvListResponse, AdminCpcvRow } from "@/lib/types/api";
import { DAY_SECS } from "@/lib/units";

import { LoadError } from "./confirm-dialog";
import { CancelDialog, CpcvDetailsDialog, SettleDialog } from "./cpcv-dialogs";
import { ViewPdfButton } from "./cpcv-upload";
import { useAdminResource } from "./use-admin-resource";

const FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "Active", match: (r: AdminCpcvRow) => r.status === "MINTED" },
  { id: "overdue", label: "Overdue", match: (r: AdminCpcvRow) => r.overdue },
  { id: "settled", label: "Settled", match: (r: AdminCpcvRow) => r.status === "SETTLED" },
  { id: "cancelled", label: "Cancelled", match: (r: AdminCpcvRow) => r.status === "CANCELLED" },
  { id: "written-off", label: "Written off", match: (r: AdminCpcvRow) => r.status === "WRITTEN_OFF" },
  { id: "failed", label: "Failed", match: (r: AdminCpcvRow) => r.status === "FAILED" || r.status === "PROVING" || r.status === "DRAFT" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

type Dialogs = { kind: "settle" | "cancel" | "details"; row: AdminCpcvRow } | null;

/** /admin/cpcvs: every CPCV with its decrypted property, the deal actions and the proof (spec §10.2). */
export function CpcvsPanel() {
  const { data, error, loading, refreshing, refresh } = useAdminResource<AdminCpcvListResponse>("/api/admin/cpcv");
  const [filter, setFilter] = useState<FilterId>("all");
  const [dialog, setDialog] = useState<Dialogs>(null);
  const close = () => setDialog(null);

  const protocolDay = data?.clock ? Math.floor(data.clock.protocolNow / DAY_SECS) : null;
  const rows = data?.cpcvs ?? [];
  const active = FILTERS.find((f) => f.id === filter)!;
  const visible = rows.filter(active.match);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="CPCVs"
        title="Every deal and"
        accent="its note"
        description="Confirm the escritura to settle a note, or cancel it if the buyer walked away. Personal data is decrypted for admins only."
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RotateCw className="size-4" />} loading={refreshing && !loading} onClick={refresh}>
              Refresh
            </Button>
            <Button href="/admin/cpcvs/new" size="sm" arrow>
              New CPCV
            </Button>
          </>
        }
      />

      <div role="group" aria-label="Filter by status" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((f) => {
          const count = rows.filter(f.match).length;
          const selected = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors",
                selected ? "bg-primary-tint text-primary-text ring-primary/40" : "bg-card text-fg ring-line hover:bg-slate-50 dark:hover:bg-slate-800",
              )}
            >
              {f.label}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", selected ? "bg-primary/15" : "bg-slate-100 text-muted dark:bg-slate-800")}>{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div aria-busy className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : !data && error ? (
        <LoadError error={error} onRetry={refresh} />
      ) : (
        <DataTable
          rows={visible}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              variant="plain"
              icon={<Inbox />}
              title={rows.length === 0 ? "No CPCVs yet" : "Nothing matches this filter"}
              description={rows.length === 0 ? "Create the first one: the proof is generated and the note minted in about a minute." : undefined}
              action={
                rows.length === 0 ? (
                  <Button href="/admin/cpcvs/new" size="sm" arrow>
                    New CPCV
                  </Button>
                ) : undefined
              }
            />
          }
          columns={[
            {
              key: "agent",
              header: "Agent",
              cell: (r) => (
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-heading">{r.agent.displayName ?? r.agent.email}</span>
                  {r.agent.smartAccount ? (
                    <Address address={r.agent.smartAccount} copy={false} label="agent smart account" className="text-xs" />
                  ) : (
                    <span className="text-xs text-muted">{r.agent.email}</span>
                  )}
                </div>
              ),
            },
            {
              key: "property",
              header: "Property",
              hideBelow: "lg",
              cell: (r) =>
                r.piiUnavailable ? (
                  <span className="text-sm text-amber-700 dark:text-amber-300">Encrypted (key mismatch)</span>
                ) : (
                  <div className="flex max-w-[14rem] flex-col gap-0.5">
                    <span className="truncate text-fg" title={r.propertyAddress}>
                      {r.propertyAddress}
                    </span>
                    <span className="truncate text-xs text-muted" title="Seller → buyer">
                      {r.sellerName} → {r.buyerName}
                    </span>
                  </div>
                ),
            },
            {
              key: "commission",
              header: "Total commission",
              align: "right",
              cell: (r) => (
                <div className="flex flex-col items-end gap-0.5">
                  <Amount value={r.totalCommission} className="font-semibold text-heading" />
                  <span className="text-xs text-muted">
                    agent <Amount value={r.agentCommission} />
                  </span>
                </div>
              ),
            },
            {
              key: "escritura",
              header: "Escritura",
              cell: (r) => (
                <div className="flex flex-col gap-0.5">
                  <DateText value={r.escrituraDay} />
                  {protocolDay !== null && r.status === "MINTED" && (
                    <span className={cn("text-xs", r.overdue ? "font-semibold text-orange-600 dark:text-orange-400" : "text-muted")}>
                      {formatRelativeDays(r.escrituraDay, protocolDay)}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (r) => (
                <div className="flex flex-col items-start gap-1">
                  <span className="flex flex-wrap gap-1.5">
                    <StatusBadge status={r.status} />
                    {r.overdue && <StatusBadge status="Overdue" />}
                  </span>
                  {r.status === "FAILED" && r.error && (
                    <span className="max-w-[11rem] truncate text-xs text-red-600 dark:text-red-400" title={r.error}>
                      {r.error}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "note",
              header: "Note",
              cell: (r) => (
                <div className="flex items-center gap-1">
                  {r.noteId !== null ? (
                    <span className="flex flex-col gap-0.5">
                      <Link href={`/registry/${r.noteId}`} className="font-semibold text-primary-text underline-offset-4 hover:underline">
                        #{r.noteId}
                      </Link>
                      {r.mintTxHash && (
                        <TxLink hash={r.mintTxHash} className="text-xs">
                          tx
                        </TxLink>
                      )}
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                  <IconButton
                    size="sm"
                    label={r.noteId !== null ? `View proof and details of note #${r.noteId}` : "View details of this CPCV"}
                    onClick={() => setDialog({ kind: "details", row: r })}
                  >
                    <FileSearch aria-hidden className="size-4" />
                  </IconButton>
                </div>
              ),
            },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right",
              cell: (r) =>
                r.status === "MINTED" || r.document ? (
                  <div className="flex flex-col items-stretch gap-1.5">
                    {r.status === "MINTED" && (
                      <>
                        <Button size="sm" className="px-3" onClick={() => setDialog({ kind: "settle", row: r })}>
                          Confirm escritura
                        </Button>
                        <Button size="sm" variant="secondary" className="px-3 text-[13px]" onClick={() => setDialog({ kind: "cancel", row: r })}>
                          Cancel (buyer withdrew)
                        </Button>
                      </>
                    )}
                    {r.document && <ViewPdfButton cpcvId={r.id} fileName={r.document.fileName} />}
                  </div>
                ) : null,
            },
          ]}
        />
      )}

      <SettleDialog row={dialog?.kind === "settle" ? dialog.row : null} onClose={close} onDone={refresh} />
      <CancelDialog row={dialog?.kind === "cancel" ? dialog.row : null} onClose={close} onDone={refresh} />
      <CpcvDetailsDialog row={dialog?.kind === "details" ? dialog.row : null} onClose={close} />
    </div>
  );
}
