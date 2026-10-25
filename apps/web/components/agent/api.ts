// The agent app's calls to its API routes, behind an interface so the preview
// gallery (and tests) can swap in a fake.

import type {
  AgentOverviewResponse,
  ApiError,
  AuthorizationStatusResponse,
  CardRevealResponse,
  SimulateRequest,
  SimulateResponse,
} from "@/lib/types/api";

export class AgentApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface AgentApi {
  overview(): Promise<AgentOverviewResponse>;
  simulate(body: SimulateRequest): Promise<SimulateResponse>;
  authorization(id: string): Promise<AuthorizationStatusResponse>;
  reveal(): Promise<CardRevealResponse>;
}

async function request<T>(url: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: init.body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AgentApiError("Network error: check your connection and try again", "NETWORK", 0);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as ApiError | null)?.error;
    throw new AgentApiError(error?.message ?? `Request failed (${res.status})`, error?.code ?? "HTTP_ERROR", res.status);
  }
  return data as T;
}

/** The real routes: /api/agent/overview and /api/agent/card/*. */
export const httpAgentApi: AgentApi = {
  overview: () => request<AgentOverviewResponse>("/api/agent/overview"),
  simulate: (body) => request<SimulateResponse>("/api/agent/card/simulate", { method: "POST", body }),
  authorization: (id) => request<AuthorizationStatusResponse>(`/api/agent/card/authorizations/${encodeURIComponent(id)}`),
  reveal: () => request<CardRevealResponse>("/api/agent/card/reveal"),
};

/** Human message for any thrown error. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : "Something went wrong. Please try again.");
