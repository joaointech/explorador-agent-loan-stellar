"use client";
import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { NoteStatusDto, RegistryNote, RegistryResponse } from "@/lib/api-types";
import { Address, EmptyState, ErrorNote, NoteStatusBadge, OverdueBadge, PageHeader, TxLink } from "@/components/common";
import { TrustModel } from "@/components/trust-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, errorMessage } from "@/lib/client/api";
import { formatDay, formatProtocolDate, formatStroops } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILTERS: { key: NoteStatusDto | "all"; label: string; count: (c: RegistryResponse["counts"]) => number }[] = [
  { key: "all", label: "All", count: (c) => c.total },
  { key: "Active", label: "Active", count: (c) => c.active },
  { key: "Settled", label: "Settled", count: (c) => c.settled },
  { key: "Cancelled", label: "Cancelled", count: (c) => c.cancelled },
  { key: "WrittenOff", label: "Written off", count: (c) => c.writtenOff },
];

export function RegistryApp() {
  const [status, setStatus] = React.useState<NoteStatusDto | "all">("all");
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [notes, setNotes] = React.useState<RegistryNote[] | null>(null);
  const [counts, setCounts] = React.useState<RegistryResponse["counts"] | null>(null);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reqRef = React.useRef(0);

  React.useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const url = React.useCallback(
    (c: number | null) => {
      const p = new URLSearchParams();
      if (status !== "all") p.set("status", status);
      if (query) p.set("q", query);
      if (c !== null) p.set("cursor", String(c));
      const s = p.toString();
      return `/api/registry${s ? `?${s}` : ""}`;
    },
    [status, query],
  );

  React.useEffect(() => {
    const req = ++reqRef.current;
    setNotes(null);
    setError(null);
    apiGet<RegistryResponse>(url(null))
      .then((r) => {
        if (req !== reqRef.current) return;
        setNotes(r.notes);
        setCounts(r.counts);
        setCursor(r.nextCursor);
      })
      .catch((e) => req === reqRef.current && setError(errorMessage(e)));
  }, [url]);

  async function loadMore() {
    if (cursor === null) return;
    const req = reqRef.current;
    setLoadingMore(true);
    try {
      const r = await apiGet<RegistryResponse>(url(cursor));
      if (req !== reqRef.current) return;
      setNotes((n) => [...(n ?? []), ...r.notes]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Public registry" first="Every deal, on-chain." second="No personal data.">
        <p className="mt-3 max-w-2xl text-ink-soft">
          Each CPCV Note is a soulbound token on Stellar, minted only after its zero-knowledge proof verifies on-chain. Anyone can check it —
          nobody can see who bought what.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {FILTERS.map((f) => (
            <div key={f.key} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">{f.key === "all" ? "Total notes" : f.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{counts ? f.count(counts) : "…"}</div>
            </div>
          ))}
        </div>
      </PageHeader>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
        <TrustModel compact />

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="radiogroup" aria-label="Filter by status" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="radio"
                aria-checked={status === f.key}
                onClick={() => setStatus(f.key)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                  status === f.key ? "bg-primary text-white" : "text-muted hover:text-ink",
                )}
              >
                {f.label}
                {counts && <span className="ml-1.5 tabular-nums opacity-70">{f.count(counts)}</span>}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Note # or agent address" className="pl-9" aria-label="Search notes" />
          </div>
        </div>

        {error && <ErrorNote className="mt-4">{error}</ErrorNote>}

        <div className="mt-4">
          {notes === null ? (
            !error && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            )
          ) : notes.length === 0 ? (
            <EmptyState title="No notes match">{query ? "Try a note number like 3, or a full agent address." : "Notes appear here as deals are minted."}</EmptyState>
          ) : (
            <>
              <NotesTable notes={notes} />
              <NotesCards notes={notes} />
            </>
          )}
        </div>

        {cursor !== null && notes && (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function NotesTable({ notes }: { notes: RegistryNote[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-warm text-xs text-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">Note</th>
            <th className="px-4 py-3 font-semibold">Agent</th>
            <th className="px-4 py-3 text-right font-semibold">Total commission</th>
            <th className="px-4 py-3 text-right font-semibold">Agent commission</th>
            <th className="px-4 py-3 text-right font-semibold">Credit limit</th>
            <th className="px-4 py-3 font-semibold">Escritura</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Minted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {notes.map((n) => (
            <tr key={n.id} className="transition-colors hover:bg-primary-faint/60">
              <td className="px-4 py-3">
                <Link href={`/registry/${n.id}`} className="font-bold text-primary hover:underline">
                  #{n.id}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Address value={n.agent} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatStroops(n.totalCommission)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatStroops(n.agentCommission)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatStroops(n.creditLimit)}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(n.escrituraDay)}</td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap gap-1">
                  <NoteStatusBadge status={n.status} />
                  {n.overdue && <OverdueBadge />}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <span className="block tabular-nums">{formatProtocolDate(n.mintedAt)}</span>
                <TxLink hash={n.mintTxHash} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotesCards({ notes }: { notes: RegistryNote[] }) {
  return (
    <ul className="grid gap-3 md:hidden">
      {notes.map((n) => (
        <li key={n.id} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/registry/${n.id}`} className="text-lg font-bold text-primary">
              Note #{n.id}
            </Link>
            <span className="flex gap-1">
              <NoteStatusBadge status={n.status} />
              {n.overdue && <OverdueBadge />}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Agent</dt>
            <dd className="text-right">
              <Address value={n.agent} />
            </dd>
            <dt className="text-muted">Total commission</dt>
            <dd className="text-right tabular-nums">{formatStroops(n.totalCommission)}</dd>
            <dt className="text-muted">Agent commission</dt>
            <dd className="text-right tabular-nums">{formatStroops(n.agentCommission)}</dd>
            <dt className="text-muted">Credit limit</dt>
            <dd className="text-right font-semibold tabular-nums">{formatStroops(n.creditLimit)}</dd>
            <dt className="text-muted">Escritura</dt>
            <dd className="text-right tabular-nums">{formatDay(n.escrituraDay)}</dd>
            <dt className="text-muted">Minted</dt>
            <dd className="text-right">
              <span className="tabular-nums">{formatProtocolDate(n.mintedAt)}</span> <TxLink hash={n.mintTxHash} />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
