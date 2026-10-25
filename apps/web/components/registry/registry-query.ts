// URL state of the public registry (spec §10.2 /registry): status filter and
// search (`q` = note id or agent address) live in the page URL so filtered
// views can be shared; the same values go to GET /api/registry (spec §9.7).

import type { RegistryStatus } from "@/lib/types/api";

export const REGISTRY_STATUSES = ["Active", "Settled", "Cancelled", "WrittenOff"] as const satisfies readonly RegistryStatus[];

export const STATUS_FILTERS: { value: RegistryStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "Active", label: "Active" },
  { value: "Settled", label: "Settled" },
  { value: "Cancelled", label: "Cancelled" },
  { value: "WrittenOff", label: "Written off" },
];

/** Notes per request; "Load more" asks for the next page with the API's cursor. */
export const PAGE_SIZE = 25;
/** The API rejects longer searches. */
export const MAX_QUERY_LENGTH = 100;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** "Active", "active", "written-off"… → RegistryStatus; anything else (or "all") → null. */
export function parseStatusParam(raw: string | null | undefined): RegistryStatus | null {
  if (!raw) return null;
  return REGISTRY_STATUSES.find((s) => squash(s) === squash(raw)) ?? null;
}

/** Trimmed, single-spaced, at most 100 characters. */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

export interface RegistryFilters {
  status: RegistryStatus | null;
  q: string;
}

/** Reads the filters from the page's search params. */
export function filtersFromSearchParams(params: Pick<URLSearchParams, "get">): RegistryFilters {
  return { status: parseStatusParam(params.get("status")), q: normalizeQuery(params.get("q")) };
}

function query(entries: [string, string | number | null | undefined][]): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** GET /api/registry?status&q&cursor&limit */
export function registryApiUrl({ status, q, cursor, limit = PAGE_SIZE }: RegistryFilters & { cursor?: string | null; limit?: number }): string {
  return `/api/registry${query([
    ["status", status],
    ["q", normalizeQuery(q)],
    ["cursor", cursor],
    ["limit", limit],
  ])}`;
}

/** The registry page for these filters: "/registry", "/registry?status=Active&q=12". */
export function registryPageHref({ status, q }: Partial<RegistryFilters>): string {
  return `/registry${query([
    ["status", status ?? null],
    ["q", normalizeQuery(q)],
  ])}`;
}

export const noteHref = (id: number) => `/registry/${id}`;

/** The detail API for one note. */
export const noteApiUrl = (id: number) => `/api/registry/${id}`;

/** A note id path segment ("12"): a u32, as the API accepts. */
export function parseNoteIdParam(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= 0xffff_ffff ? id : null;
}
