"use client";

import { useEffect, useState } from "react";

import { ApiRequestError, fetchJson, toApiRequestError } from "./api-client";

type Settled<T> = { url: string; nonce: number } & ({ ok: true; data: T } | { ok: false; error: ApiRequestError });

export type ApiResource<T> = { retry: () => void } & (
  | { status: "loading"; data?: undefined; error?: undefined; refreshing?: undefined }
  | { status: "success"; data: T; error?: undefined; /** A newer request is in flight. */ refreshing: boolean }
  | { status: "error"; data?: undefined; error: ApiRequestError; refreshing?: undefined }
);

/**
 * GET a public API route from the browser: loading → success | error, with
 * `retry()`. State is derived from the last settled request, so no state is
 * reset synchronously inside an effect.
 *
 *   const stats = useApiResource<PoolStatsResponse>("/api/pool/stats", { refreshMs: 60_000 });
 *
 * - `refreshMs`: refetch in the background while the tab is visible (keeps the data shown).
 * - `keepPrevious`: when `url` changes, keep showing the previous data (marked
 *   `refreshing`) until the new response arrives, instead of a loading state.
 */
export function useApiResource<T>(url: string | null, { refreshMs, keepPrevious = false }: { refreshMs?: number; keepPrevious?: boolean } = {}): ApiResource<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    fetchJson<T>(url, controller.signal).then(
      (data) => setSettled({ url, nonce, ok: true, data }),
      (err: unknown) => {
        if (!controller.signal.aborted) setSettled({ url, nonce, ok: false, error: toApiRequestError(err) });
      },
    );
    return () => controller.abort();
  }, [url, nonce]);

  useEffect(() => {
    if (!refreshMs || url === null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, url]);

  const retry = () => setNonce((n) => n + 1);

  if (settled && settled.url === url) {
    if (settled.ok) return { status: "success", data: settled.data, refreshing: settled.nonce !== nonce, retry };
    if (settled.nonce === nonce) return { status: "error", error: settled.error, retry };
    return { status: "loading", retry };
  }
  if (keepPrevious && settled?.ok) return { status: "success", data: settled.data, refreshing: true, retry };
  return { status: "loading", retry };
}
