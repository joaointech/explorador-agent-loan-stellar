"use client";

import { Clock } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/components/ui/cn";
import { formatDate, formatDuration } from "@/lib/format";
import type { DemoClock, PoolStatsResponse } from "@/lib/types/api";

// Demo clock (spec §5.7). One shared poller for every subscriber: the header
// renders the chip twice (inline on desktop, a slim bar on phones) and the
// admin panel can read the same state, but /api/pool/stats is fetched once per
// interval. Polling pauses while the tab is hidden.

const POLL_MS = 30_000;
const STATS_URL = "/api/pool/stats";

export interface DemoClockState {
  clock: DemoClock;
  /** Wall-clock ms when `clock` was fetched (to extrapolate protocolNow). */
  fetchedAtMs: number;
}

let current: DemoClockState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function isClock(v: unknown): v is DemoClock {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.protocolNow === "number" && typeof c.offsetSecs === "number" && typeof c.demoMode === "boolean";
}

function load(): Promise<void> {
  inflight ??= (async () => {
    try {
      const res = await fetch(STATS_URL, { cache: "no-store", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Partial<PoolStatsResponse>;
      if (!isClock(body.clock)) throw new Error("No clock in response");
      current = { clock: body.clock, fetchedAtMs: Date.now() };
    } catch {
      // Error or 404 (pool not deployed yet): render nothing.
      current = null;
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

function onVisibility() {
  if (document.visibilityState === "visible") void load();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

/** Live demo clock from GET /api/pool/stats (polled every 30 s), or null when unavailable. */
export function useDemoClock(): DemoClockState | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Re-fetch now, e.g. right after the admin fast-forwards the clock. */
export function refreshDemoClock(): Promise<void> {
  return load();
}

/** "+81 days", "+1 day", or "+3h" for offsets under a day. */
export function formatClockOffset(offsetSecs: number): string {
  const days = Math.floor(offsetSecs / 86_400);
  if (days >= 1) return `+${days} ${days === 1 ? "day" : "days"}`;
  return `+${formatDuration(offsetSecs, { style: "short", maxUnits: 1 })}`;
}

/**
 * "Demo clock · 14 Jan 2027 (+81 days)" (spec §5.7). Shown only while the
 * protocol clock is fast-forwarded (`offsetSecs > 0`); renders nothing on
 * error or 404.
 * - `inline`: chip in the desktop header bar (lg and up).
 * - `bar`: slim full-width strip under the header on smaller screens.
 */
export function DemoClockChip({ placement }: { placement: "inline" | "bar" }) {
  const state = useDemoClock();
  if (!state || state.clock.offsetSecs <= 0) return null;

  const date = formatDate(state.clock.protocolNow);
  const offset = formatClockOffset(state.clock.offsetSecs);
  const title = "The protocol clock is fast-forwarded for this demo. Deals, interest and grace periods use this date.";

  const content = (
    <>
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-live-ring rounded-full bg-amber-300" />
        <span className="relative inline-flex size-2 rounded-full bg-amber-300" />
      </span>
      <Clock aria-hidden className="size-3.5 opacity-80" />
      <span>
        Demo clock · <time dateTime={new Date(state.clock.protocolNow * 1000).toISOString()}>{date}</time>{" "}
        <span className="text-white/75">({offset})</span>
      </span>
    </>
  );

  if (placement === "bar") {
    return (
      <div className="border-t border-white/15 bg-black/10 lg:hidden dark:bg-white/5" title={title}>
        <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold text-white">
          {content}
        </p>
      </div>
    );
  }

  return (
    <p
      title={title}
      className={cn(
        "hidden shrink-0 items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white ring-1 ring-white/25 lg:inline-flex",
      )}
    >
      {content}
    </p>
  );
}
