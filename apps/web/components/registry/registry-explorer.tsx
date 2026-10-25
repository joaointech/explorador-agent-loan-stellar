"use client";

import { Inbox, LoaderCircle, Search, SearchX, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { formatNumber } from "@/lib/format";
import type { RegistryListResponse, RegistryNote, RegistryStatus } from "@/lib/types/api";

import { fetchJson, toApiRequestError, type ApiRequestError } from "./api-client";
import { LoadError } from "./load-error";
import { RegistryLayout } from "./registry-layout";
import {
  MAX_QUERY_LENGTH,
  STATUS_FILTERS,
  filtersFromSearchParams,
  normalizeQuery,
  registryApiUrl,
  registryPageHref,
  type RegistryFilters,
} from "./registry-query";
import { RegistryResults, RegistryResultsSkeleton } from "./registry-results";
import { StatusCounts } from "./status-counts";
import { useApiResource } from "./use-api-resource";

const SEARCH_DEBOUNCE_MS = 350;

const STATUS_DOT: Record<RegistryStatus, string> = {
  Active: "bg-blue-500",
  Settled: "bg-emerald-500",
  Cancelled: "bg-amber-500",
  WrittenOff: "bg-red-500",
};

function StatusFilter({ value, onChange }: { value: RegistryStatus | null; onChange: (status: RegistryStatus | null) => void }) {
  return (
    <div role="group" aria-label="Filter by status" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
      {STATUS_FILTERS.map((f) => {
        const selected = f.value === value;
        return (
          <button
            key={f.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(f.value)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 transition-colors",
              selected ? "bg-primary text-primary-fg ring-primary" : "bg-card text-fg ring-line hover:bg-primary-tint hover:text-primary-text",
            )}
          >
            {f.value && <span aria-hidden className={cn("size-2 rounded-full", STATUS_DOT[f.value], selected && "ring-2 ring-white/70")} />}
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

/** The search box's text, the URL query it last saw, and searches sent whose URL echo hasn't arrived. */
export interface SearchSync {
  draft: string;
  synced: string;
  sent: string[];
}

/**
 * Reconciles the search box with the URL's `q`. The router applies History
 * API updates in a transition, so `value` can lag typing: when it changes to a
 * term we sent, it's our own echo and the draft (maybe typed further since)
 * stays; any other change (Back/Forward, the empty state's "Clear search")
 * replaces the draft.
 */
export function syncSearch(state: SearchSync, value: string): SearchSync {
  if (value === state.synced) return state;
  const echo = state.sent.indexOf(value);
  if (echo >= 0) return { ...state, synced: value, sent: state.sent.slice(echo + 1) };
  return { draft: normalizeQuery(state.draft) === value ? state.draft : value, synced: value, sent: [] };
}

/**
 * Search box for a note id ("12", "#12") or an agent address (full, partial
 * or "CDLZ…4XQA"). Typing updates the URL after a short pause; Enter at once.
 */
function RegistrySearch({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [stored, setStored] = useState<SearchSync>({ draft: value, synced: value, sent: [] });
  const current = syncSearch(stored, value);
  if (current !== stored) setStored(current);
  const { draft } = current;

  const setDraft = (text: string) => setStored((s) => ({ ...syncSearch(s, value), draft: text }));
  const send = (q: string) => {
    setStored((s) => ({ ...s, sent: [...s.sent, q] }));
    onSearch(q);
  };

  const search = useEffectEvent((q: string) => send(q));
  useEffect(() => {
    const term = normalizeQuery(draft);
    if (term === value) return;
    const timer = setTimeout(() => search(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = normalizeQuery(draft);
    if (term !== value) send(term);
  };

  return (
    <form role="search" onSubmit={submit} className="relative w-full sm:max-w-sm">
      <label htmlFor="registry-search" className="sr-only">
        Search by note number or agent address
      </label>
      <Input
        id="registry-search"
        type="search"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_QUERY_LENGTH}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Note # or agent address"
        prefix={<Search />}
        inputClassName="pr-11 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft("");
            if (value) send("");
          }}
          className="absolute inset-y-0 right-1 my-auto inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-fg dark:hover:bg-slate-800"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </form>
  );
}

interface MorePages {
  key: string;
  pages: RegistryListResponse[];
  loading: boolean;
  error: ApiRequestError | null;
}

const uniqueById = (notes: RegistryNote[]) => {
  const seen = new Set<number>();
  return notes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
};

const statusLabel = (status: RegistryStatus | null) => STATUS_FILTERS.find((f) => f.value === status)?.label.toLowerCase() ?? "";

/** "5 notes", "Showing 25 of 57 notes", "2 active notes", "1 note matching “12”", "25+ notes matching “C”". */
export function resultSummary(filters: RegistryFilters, shown: number, counts: RegistryListResponse["counts"] | null, hasMore = false): string {
  const noun = (n: number, plural = false) => `${filters.status ? `${statusLabel(filters.status)} ` : ""}${n === 1 && !plural ? "note" : "notes"}`;
  const total = !filters.q && counts ? (filters.status ? counts[filters.status] : counts.total) : null;
  if (total !== null && total > shown) return `Showing ${formatNumber(shown)} of ${formatNumber(total)} ${noun(total)}`;
  const base = hasMore ? `${formatNumber(shown)}+ ${noun(shown, true)}` : `${formatNumber(shown)} ${noun(shown)}`;
  return filters.q ? `${base} matching “${filters.q}”` : base;
}

/**
 * The public registry (spec §10.2 /registry): counts by status, the trust
 * model, then every note with a status filter, search and cursor pagination
 * ("Load more"). Filters live in the URL (`?status=&q=`), updated with the
 * History API so typing never waits for a server round trip.
 */
export function RegistryExplorer({ explainer }: { explainer: ReactNode }) {
  const searchParams = useSearchParams();
  const filters = filtersFromSearchParams(searchParams);
  const firstUrl = registryApiUrl(filters);
  const first = useApiResource<RegistryListResponse>(firstUrl, { keepPrevious: true });
  const [more, setMore] = useState<MorePages>({ key: "", pages: [], loading: false, error: null });
  const extra: MorePages = more.key === firstUrl ? more : { key: firstUrl, pages: [], loading: false, error: null };

  const firstPage = first.status === "success" ? first.data : null;
  const pages = firstPage ? (first.refreshing ? [firstPage] : [firstPage, ...extra.pages]) : [];
  const notes = uniqueById(pages.flatMap((p) => p.notes ?? []));
  const nextCursor = pages.length > 0 ? pages[pages.length - 1].nextCursor : null;
  const counts = firstPage?.counts ?? null;

  function navigate(next: Partial<RegistryFilters>, mode: "push" | "replace") {
    const href = registryPageHref({ ...filters, ...next });
    if (href === registryPageHref(filters)) return;
    if (mode === "push") window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
  }

  async function loadMore() {
    if (!nextCursor || extra.loading || first.refreshing) return;
    const key = firstUrl;
    setMore({ ...extra, loading: true, error: null });
    try {
      const page = await fetchJson<RegistryListResponse>(registryApiUrl({ ...filters, cursor: nextCursor }));
      setMore((m) => (m.key === key ? { ...m, pages: [...m.pages, page], loading: false } : m));
    } catch (err) {
      setMore((m) => (m.key === key ? { ...m, loading: false, error: toApiRequestError(err) } : m));
    }
  }

  let results: ReactNode;
  if (first.status === "loading" || (first.refreshing && notes.length === 0)) {
    results = <RegistryResultsSkeleton />;
  } else if (first.status === "error") {
    results = <LoadError title="Couldn't load the registry" error={first.error} onRetry={first.retry} />;
  } else if (notes.length === 0) {
    results = filters.q ? (
      <EmptyState
        icon={<SearchX />}
        title={`No notes match “${filters.q}”`}
        description="Search by note number (12 or #12) or by agent address: the full address, part of it, or the short form shown in the table."
        action={
          <Button variant="secondary" size="sm" onClick={() => navigate({ q: "" }, "push")}>
            Clear search
          </Button>
        }
      />
    ) : filters.status ? (
      <EmptyState
        icon={<Inbox />}
        title={`No ${statusLabel(filters.status)} notes`}
        description="Try another status."
        action={
          <Button variant="secondary" size="sm" onClick={() => navigate({ status: null }, "push")}>
            Show all notes
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<Inbox />} title="No notes yet" description="CPCV Notes appear here as soon as explorador mints them on Stellar." />
    );
  } else {
    results = (
      <div className={cn("transition-opacity", first.refreshing && "opacity-60")}>
        <RegistryResults notes={notes} />
        {(nextCursor || extra.error) && (
          <div className="mt-5 flex flex-col items-center gap-2">
            {extra.error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                Couldn&apos;t load more notes: {extra.error.message}
              </p>
            )}
            {nextCursor && (
              <Button variant="secondary" loading={extra.loading} disabled={first.refreshing} onClick={loadMore}>
                {extra.error ? "Try again" : "Load more notes"}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  const status =
    first.status === "success"
      ? first.refreshing
        ? "Updating results…"
        : resultSummary(filters, notes.length, counts, nextCursor !== null)
      : first.status === "loading"
        ? "Loading notes…"
        : "";

  return (
    <RegistryLayout counts={<StatusCounts counts={counts} loading={first.status === "loading"} />} explainer={explainer}>
      <div>
        <h2 id="notes-title" className="text-xl font-bold tracking-tight text-heading sm:text-2xl">
          Notes
        </h2>
        <p role="status" className="mt-1 flex min-h-5 items-center gap-1.5 text-sm text-muted">
          {first.refreshing && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
          {status}
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <StatusFilter value={filters.status} onChange={(status) => navigate({ status }, "push")} />
        <RegistrySearch value={filters.q} onSearch={(q) => navigate({ q }, "replace")} />
      </div>
      <div className="mt-5" aria-busy={first.status === "loading" || first.refreshing || undefined}>
        {results}
      </div>
    </RegistryLayout>
  );
}

/** Suspense fallback with the same layout (only shown if the page is ever prerendered). */
export function RegistryExplorerFallback({ explainer }: { explainer: ReactNode }) {
  return (
    <RegistryLayout counts={<StatusCounts counts={null} loading />} explainer={explainer}>
      <h2 id="notes-title" className="text-xl font-bold tracking-tight text-heading sm:text-2xl">
        Notes
      </h2>
      <div className="mt-5" aria-busy>
        <RegistryResultsSkeleton />
      </div>
    </RegistryLayout>
  );
}
