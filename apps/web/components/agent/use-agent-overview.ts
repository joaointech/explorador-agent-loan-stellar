"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loginPath } from "@/lib/auth/redirect";
import type { AgentOverviewResponse } from "@/lib/types/api";

import { AgentApiError, errorMessage, type AgentApi } from "./api";

/** Overview refresh interval (spec §10.2: every ~10 s, plus after actions). */
export const OVERVIEW_POLL_MS = 10_000;

export interface AgentOverviewState {
  data: AgentOverviewResponse;
  /** Last refresh error (the previous data stays on screen). */
  error: string | null;
  refreshing: boolean;
  /** Refreshes now; concurrent calls share one request. */
  refresh: () => Promise<void>;
}

/**
 * Keeps the overview fresh: polls every `intervalMs` while the tab is visible,
 * refreshes when it becomes visible again, and exposes `refresh()` for actions.
 * Each response's `fetchedAtMs` is re-stamped with this browser's clock, so the
 * protocol clock and interest extrapolate correctly even if the server's clock
 * differs. A 401 (session ended) goes back to /login.
 */
export function useAgentOverview(initial: AgentOverviewResponse, api: AgentApi, { intervalMs = OVERVIEW_POLL_MS } = {}): AgentOverviewState {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    setRefreshing(true);
    const run = api
      .overview()
      .then(
        (next) => {
          setData({ ...next, rates: { ...next.rates, fetchedAtMs: Date.now() } });
          setError(null);
        },
        (err: unknown) => {
          if (err instanceof AgentApiError && err.status === 401) {
            window.location.assign(loginPath("/agent"));
            return;
          }
          setError(errorMessage(err));
        },
      )
      .finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
    inflight.current = run;
    return run;
  }, [api]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      timer ??= setInterval(() => void refresh(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, refresh]);

  return { data, error, refreshing, refresh };
}
