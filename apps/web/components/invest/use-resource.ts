"use client";

import { useEffect, useEffectEvent, useState } from "react";

import type { ApiError } from "@/lib/types/api";

import type { Remote } from "./model";

interface Entry<T> {
  data?: T;
  error: string | null;
}

interface CacheState<T> {
  entries: Record<string, Entry<T>>;
  /** Most recent data of any key (kept on screen while another key loads). */
  last?: T;
}

export interface Resource<T> extends Remote<T> {
  refresh: () => Promise<void>;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Fetches `load(key)` whenever `key` changes (null = idle) and every
 * `intervalMs` while the tab is visible. Results are cached per key, so a
 * refetch never blanks the screen; with `keepPrevious`, the last data of
 * another key stays visible while a new key loads (e.g. a chart range).
 */
export function useResource<T>(
  key: string | null,
  load: (key: string) => Promise<T>,
  { intervalMs, keepPrevious = false }: { intervalMs?: number; keepPrevious?: boolean } = {},
): Resource<T> {
  const [cache, setCache] = useState<CacheState<T>>({ entries: {} });

  const fetchKey = async (k: string) => {
    try {
      const data = await load(k);
      setCache((c) => ({ entries: { ...c.entries, [k]: { data, error: null } }, last: data }));
    } catch (err) {
      setCache((c) => ({ ...c, entries: { ...c.entries, [k]: { data: c.entries[k]?.data, error: errorMessage(err) } } }));
    }
  };

  const onTick = useEffectEvent((k: string) => {
    void fetchKey(k);
  });

  useEffect(() => {
    if (key === null) return;
    onTick(key);
    if (!intervalMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") onTick(key);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [key, intervalMs]);

  const entry = key === null ? undefined : cache.entries[key];
  const loading = key !== null && entry === undefined;
  return {
    data: entry?.data ?? (keepPrevious && key !== null ? cache.last : undefined),
    error: entry?.error ?? null,
    loading,
    refresh: () => (key === null ? Promise.resolve() : fetchKey(key)),
  };
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** GET a JSON API route; non-2xx responses throw with the `{ error: { code, message } }` body. */
export async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "can't reach the server");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as ApiError | null)?.error;
    throw new ApiRequestError(res.status, error?.code ?? `HTTP_${res.status}`, error?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}
