"use client";

import { useSyncExternalStore } from "react";

// One shared ticking clock per interval, so a page full of countdowns (or live
// interest figures) runs a single timer. SSR and hydration see `null`, so
// server and client markup always match; the live value arrives right after.

interface Ticker {
  now: number;
  timer: ReturnType<typeof setInterval> | null;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

const tickers = new Map<number, Ticker>();

function ticker(intervalMs: number): Ticker {
  let t = tickers.get(intervalMs);
  if (t) return t;
  const created: Ticker = {
    now: Date.now(),
    timer: null,
    listeners: new Set(),
    subscribe: (listener) => {
      created.listeners.add(listener);
      if (!created.timer) {
        created.now = Date.now();
        created.timer = setInterval(() => {
          created.now = Date.now();
          for (const l of created.listeners) l();
        }, intervalMs);
      }
      return () => {
        created.listeners.delete(listener);
        if (created.listeners.size === 0 && created.timer) {
          clearInterval(created.timer);
          created.timer = null;
        }
      };
    },
    getSnapshot: () => created.now,
  };
  tickers.set(intervalMs, created);
  t = created;
  return t;
}

const serverSnapshot = () => null;

/** Wall-clock ms, re-rendering every `intervalMs`; null during SSR/hydration. */
export function useNow(intervalMs = 1000): number | null {
  const t = ticker(intervalMs);
  return useSyncExternalStore(t.subscribe, t.getSnapshot, serverSnapshot);
}

/**
 * The protocol clock (unix seconds, fractional), extrapolated from a value the
 * API returned: `protocolNow + (Date.now() − fetchedAtMs) / 1000`. Returns
 * `protocolNow` unchanged during SSR/hydration. Use it for live interest and
 * countdowns to escritura dates and grace deadlines (spec §5.7).
 *
 *   const now = useProtocolNow(rates.protocolNow, rates.fetchedAtMs);
 */
export function useProtocolNow(protocolNow: number, fetchedAtMs: number, intervalMs = 1000): number {
  const wall = useNow(intervalMs);
  if (wall === null) return protocolNow;
  return protocolNow + Math.max(0, wall - fetchedAtMs) / 1000;
}
