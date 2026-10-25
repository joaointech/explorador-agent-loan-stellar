// Browser-side JSON fetching for the public API (registry, pool stats), with
// the `{ error: { code, message } }` body turned into a typed error.

import type { ApiError } from "@/lib/types/api";

export class ApiRequestError extends Error {
  constructor(
    /** HTTP status; 0 when the request never got a response. */
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  get notFound(): boolean {
    return this.status === 404;
  }
}

function isApiError(body: unknown): body is ApiError {
  const e = (body as Partial<ApiError> | null)?.error;
  return !!e && typeof e.code === "string" && typeof e.message === "string";
}

/** GET a JSON API route; throws ApiRequestError (or the AbortError when aborted). */
export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiRequestError(0, "NETWORK", "Couldn't reach the server. Check your connection and try again.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (e.g. an HTML 404 while the route isn't deployed).
  }
  if (!res.ok) {
    if (isApiError(body)) throw new ApiRequestError(res.status, body.error.code, body.error.message);
    throw new ApiRequestError(res.status, `HTTP_${res.status}`, res.statusText || `Request failed (${res.status})`);
  }
  if (body === null || typeof body !== "object") throw new ApiRequestError(res.status, "BAD_RESPONSE", "The server sent an unexpected response.");
  return body as T;
}

export function toApiRequestError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;
  return new ApiRequestError(0, "UNEXPECTED", err instanceof Error ? err.message : "Something went wrong.");
}
