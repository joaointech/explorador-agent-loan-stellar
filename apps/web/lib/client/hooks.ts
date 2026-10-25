"use client";
import * as React from "react";
import type { MeResponse, PoolStatsResponse } from "@/lib/api-types";
import { apiGet } from "./api";

export interface PollState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** real time (ms) at which `data` was received */
  receivedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches `url` (GET) immediately and then every `intervalMs` while the tab is visible.
 * Pass `null` to pause. Keeps the last good data on transient errors.
 */
export function usePoll<T>(url: string | null, intervalMs = 5000): PollState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [loading, setLoading] = React.useState<boolean>(!!url);
  const [receivedAt, setReceivedAt] = React.useState<number | null>(null);
  const urlRef = React.useRef(url);
  urlRef.current = url;

  const refresh = React.useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const d = await apiGet<T>(u);
      if (urlRef.current !== u) return;
      setData(d);
      setReceivedAt(Date.now());
      setError(null);
    } catch (e) {
      if (urlRef.current !== u) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (urlRef.current === u) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setData(null);
    void refresh();
    if (intervalMs <= 0) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [url, intervalMs, refresh]);

  return { data, error, loading, receivedAt, refresh };
}

export function useMe() {
  return usePoll<MeResponse>("/api/auth/me", 0);
}

export function usePoolStats(intervalMs = 15000) {
  return usePoll<PoolStatsResponse>("/api/pool/stats", intervalMs);
}

/** Re-renders every `ms` (for live countdowns / interest ticking). */
export function useNow(ms = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Returns a debounced "busy" guard: callers can't fire more often than `ms`. */
export function useCooldown(ms = 1000): [boolean, () => void] {
  const [cooling, setCooling] = React.useState(false);
  const trigger = React.useCallback(() => {
    setCooling(true);
    setTimeout(() => setCooling(false), ms);
  }, [ms]);
  return [cooling, trigger];
}
