"use client";

import { useCallback, useEffect, useState } from "react";

import { adminRequest, toAdminApiError, type AdminApiError } from "./api";

interface State<T> {
  data: T | null;
  error: AdminApiError | null;
  /** Which load (see `version`) the state belongs to; -1 before the first one settles. */
  loaded: number;
}

/**
 * GETs an admin API resource on mount and on `refresh()`. Keeps the previous
 * data while reloading (no flicker after an action) and on a failed reload.
 */
export function useAdminResource<T>(url: string) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<State<T>>({ data: null, error: null, loaded: -1 });

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<T>(url, { signal: controller.signal }).then(
      (data) => setState({ data, error: null, loaded: version }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ data: s.data, error: toAdminApiError(err), loaded: version }));
      },
    );
    return () => controller.abort();
  }, [url, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return {
    data: state.data,
    error: state.error,
    /** True until the first response (or error) arrives. */
    loading: state.loaded === -1,
    /** True while any load is in flight, including refreshes. */
    refreshing: state.loaded !== version,
    refresh,
  };
}
