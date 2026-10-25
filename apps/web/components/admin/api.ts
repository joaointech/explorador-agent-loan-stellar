// Browser-side calls to the admin API: JSON in and out, `{ error: { code,
// message } }` turned into AdminApiError, and a signed-out session (401, e.g.
// after a demo reset recreated the users) sent back to /login.

import type { ApiError } from "@/lib/types/api";

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function toAdminApiError(err: unknown): AdminApiError {
  if (err instanceof AdminApiError) return err;
  if (err instanceof Error) return new AdminApiError(0, "NETWORK_ERROR", err.message || "Network error");
  return new AdminApiError(0, "NETWORK_ERROR", String(err));
}

/** Full navigation to the sign-in page, coming back here afterwards. */
export function redirectToLogin(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  // A full document load on purpose (also from non-component code): the
  // session is gone, so no client state from this page should survive.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/** Reads an error body (`{ error: { code, message } }`) from a failed response. */
export async function errorFromResponse(res: Response): Promise<AdminApiError> {
  const body = (await res.json().catch(() => null)) as Partial<ApiError> | null;
  return new AdminApiError(res.status, body?.error?.code ?? `HTTP_${res.status}`, body?.error?.message ?? `Request failed (HTTP ${res.status})`);
}

export interface AdminRequestInit {
  method?: "GET" | "POST";
  /** JSON body for POST (defaults to `{}`: admin mutations must be sent as JSON). */
  body?: unknown;
  signal?: AbortSignal;
}

/** Starts a request to the admin API (POSTs are sent as JSON). Doesn't read the body. */
export function adminFetch(url: string, init: AdminRequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  return fetch(url, {
    method,
    cache: "no-store",
    signal: init.signal,
    headers: method === "POST" ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
    body: method === "POST" ? JSON.stringify(init.body ?? {}) : undefined,
  });
}

/** JSON request to the admin API; throws AdminApiError on failure. */
export async function adminRequest<T>(url: string, init: AdminRequestInit = {}): Promise<T> {
  const res = await adminFetch(url, init);
  if (res.status === 401) redirectToLogin();
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

export const postAdmin = <T>(url: string, body: unknown = {}) => adminRequest<T>(url, { method: "POST", body });
