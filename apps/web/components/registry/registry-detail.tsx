"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, EyeOff, ExternalLink } from "lucide-react";
import type { ChainEventDto, RegistryDetailResponse } from "@/lib/api-types";
import { Address, EmptyState, ErrorNote, HexValue, NoteStatusBadge, OverdueBadge, TxLink } from "@/components/common";
import { PROVEN } from "@/components/trust-model";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/client/api";
import { usePoll, usePoolStats } from "@/lib/client/hooks";
import { formatDateTime, formatDay, formatProtocolDate, formatStroops, protocolDay, relativeDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VerifyProof } from "./verify-proof";

export function RegistryDetail({ id }: { id: string }) {
  const { data, error } = usePoll<RegistryDetailResponse>(`/api/registry/${encodeURIComponent(id)}`, 30_000);
  const pool = usePoolStats(60_000);
  const [signalOk, setSignalOk] = React.useState<Map<number, boolean> | null>(null);

  if (!data) {
    return (
      <Shell>
        {error ? (
          error instanceof ApiClientError && error.status === 404 ? (
            <EmptyState title={`Note #${id} does not exist`}>
              <Link href="/registry" className="font-semibold text-primary hover:underline">
                Back to the registry
              </Link>
            </EmptyState>
          ) : (
            <ErrorNote>Could not load note #{id}: {error.message}</ErrorNote>
          )
        ) : (
          <div className="grid gap-5 lg:grid-cols-12">
            <Skeleton className="h-96 rounded-3xl lg:col-span-7" />
            <Skeleton className="h-72 rounded-3xl lg:col-span-5" />
          </div>
        )}
      </Shell>
    );
  }

  const n = data.note;
  // Protocol "today" (the demo clock may be fast-forwarded); fall back to real time.
  const today = protocolDay(pool.data?.demo.protocolNow ?? Date.now() / 1000);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">CPCV Note · SEP-50 soulbound</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[32px] font-bold leading-tight tracking-tight sm:text-[40px]">
            Note <span className="text-primary">#{n.id}</span>
            <span className="flex gap-1.5">
              <NoteStatusBadge status={n.status} />
              {n.overdue && <OverdueBadge />}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted">{data.description}</p>
        </div>
        <a
          href={`/api/registry/${n.id}/metadata`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          Token metadata <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card className="p-5 sm:p-6">
            <p className="eyebrow">Public fields</p>
            <dl className="mt-3 divide-y divide-line text-sm">
              <Field label="Agent account">
                <Address value={n.agent} head={6} tail={6} />
              </Field>
              <Field label="Total commission">{formatStroops(n.totalCommission)}</Field>
              <Field label="Agent commission (50%)">{formatStroops(n.agentCommission)}</Field>
              <Field label="explorador commission">{formatStroops(n.exploradorCommission)}</Field>
              <Field label="Credit limit">
                <span className="font-bold">{formatStroops(n.creditLimit)}</span>
              </Field>
              <Field label="Escritura date">
                {formatDay(n.escrituraDay)} <span className="text-muted">· {relativeDays(n.escrituraDay, today)}</span>
              </Field>
              <Field label="Minted">
                <span className="tabular-nums">{formatProtocolDate(n.mintedAt)}</span> <TxLink hash={n.mintTxHash} />
              </Field>
              <Field label="Commitment">
                <HexValue value={n.commitment} />
              </Field>
              <Field label="Nullifier">
                <HexValue value={n.nullifier} />
              </Field>
              <Field label="Note contract">
                <Address value={data.contracts.cpcvNote} />
              </Field>
            </dl>
          </Card>

          <Card className="p-5 sm:p-6">
            <p className="eyebrow">Credit line</p>
            {data.line ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Mini label="Credit limit" value={formatStroops(data.line.creditLimit)} />
                <Mini label="Principal" value={formatStroops(data.line.principal)} />
                <Mini label="Interest" value={formatStroops(data.line.interest)} />
                <Mini label="Debt" value={formatStroops(data.line.debt)} />
                <Mini label="Available" value={formatStroops(data.line.available)} />
                <Mini label="Drawn by card (total)" value={formatStroops(data.drawsTotal)} />
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted">
                This note&apos;s line is closed. {formatStroops(data.drawsTotal)} was drawn by card over its life.
              </p>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <p className="eyebrow">Timeline</p>
            <Timeline events={data.events} />
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <VerifyProof detail={data} onSignals={setSignalOk} />

          <Card className="p-5 sm:p-6">
            <p className="eyebrow">What the proof shows</p>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              {PROVEN.map((p) => (
                <li key={p} className="flex gap-2">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {p}
                </li>
              ))}
            </ul>
            <p className="eyebrow mt-5">What stays hidden</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.hidden.map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30"
                >
                  <EyeOff className="size-3" /> {h}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              explorador is the attester: it signs that this CPCV exists. The commitment lets it open the record to an auditor later without
              changing anything on-chain.
            </p>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <p className="eyebrow">Public signals</p>
          <p className="mt-1 text-xs text-muted">The proof&apos;s public inputs, in circuit order.</p>
          <ol className="mt-3 divide-y divide-line text-sm">
            {data.publicSignals.map((s, i) => {
              const ok = signalOk?.get(i);
              return (
                <li key={i} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-semibold">{data.publicSignalLabels[i] ?? `Signal ${i}`}</span>
                    <span className="block break-all font-mono text-xs text-muted">{s}</span>
                  </span>
                  {ok !== undefined && (
                    <span className={cn("shrink-0 text-xs font-semibold", ok ? "text-emerald-600" : "text-red-600")}>{ok ? "matches note" : "mismatch"}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="p-5 sm:p-6">
          <p className="eyebrow">Groth16 proof (on-chain encoding)</p>
          <p className="mt-1 text-xs text-muted">BN254 points as stored by the contract; A is negated for the pairing check.</p>
          <div className="mt-3 space-y-2">
            {(["a", "b", "c"] as const).map((k) => (
              <details key={k} className="group rounded-xl border border-line">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
                  <span>
                    {k.toUpperCase()} <span className="font-normal text-muted">· {k === "b" ? "G2, 128 bytes" : "G1, 64 bytes"}</span>
                  </span>
                  <CopyButton value={data.proof[k]} />
                </summary>
                <p className="break-all border-t border-line px-3 py-2 font-mono text-xs text-muted">{data.proof[k]}</p>
              </details>
            ))}
          </div>
        </Card>
      </div>

      <Link href="/registry" className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" /> All notes
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-10">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-warm px-3 py-2.5">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-bold tabular-nums">{value}</dd>
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  mint: "Note minted",
  minted: "Note minted",
  note_minted: "Note minted",
  open_line: "Credit line opened",
  line_opened: "Credit line opened",
  draw: "Card draw",
  card_draw: "Card draw",
  note_settled: "Escritura confirmed — settled",
  note_cancelled: "Cancelled — buyer withdrew",
  note_status_changed: "Note status updated",
  debt_written_off: "Carried debt written off",
  settle: "Escritura confirmed — settled",
  settled: "Escritura confirmed — settled",
  cancel: "Cancelled — buyer withdrew",
  cancelled: "Cancelled — buyer withdrew",
  write_off: "Written off",
  writeoff: "Written off",
  written_off: "Written off",
  status: "Status updated",
};

function eventLabel(type: string): string {
  const k = type.toLowerCase();
  return EVENT_LABELS[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const AMOUNT_KEYS = ["amount", "from_credit", "fromCredit", "debt_repaid", "debtRepaid", "agent_payout", "agentPayout", "debt_carried", "debtCarried", "interest"];

function eventAmounts(e: ChainEventDto): string | null {
  const parts: string[] = [];
  for (const k of AMOUNT_KEYS) {
    const v = e.data[k];
    if ((typeof v === "string" && /^-?\d+$/.test(v)) || typeof v === "number") {
      parts.push(`${k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} ${formatStroops(String(v))}`);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

function Timeline({ events }: { events: ChainEventDto[] }) {
  if (events.length === 0) return <p className="mt-2 text-sm text-muted">No events indexed yet.</p>;
  return (
    <ol className="relative mt-4 space-y-4 border-l border-line pl-5">
      {events.map((e, i) => {
        const amounts = eventAmounts(e);
        return (
          <li key={`${e.txHash}-${e.type}-${i}`} className="relative">
            <span className="absolute -left-[26px] top-1 size-2.5 rounded-full bg-primary ring-4 ring-surface" />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-semibold">{eventLabel(e.type)}</p>
              <TxLink hash={e.txHash} />
            </div>
            <p className="text-xs text-muted">
              {e.protocolTs ? `${formatProtocolDate(e.protocolTs)} (protocol)` : formatDateTime(e.createdAt)} · ledger {e.ledger.toLocaleString("en-GB")}
            </p>
            {amounts && <p className="text-xs tabular-nums text-ink-soft">{amounts}</p>}
          </li>
        );
      })}
    </ol>
  );
}
