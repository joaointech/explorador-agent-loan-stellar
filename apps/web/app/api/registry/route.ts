// GET /api/registry?cursor&status&q&limit (public): notes with public data
// only, newest first; q = note id or agent address (spec §9.7, §10.2).

import type { NextRequest } from "next/server";
import { z } from "zod";

import { badRequest, route } from "@/lib/http";
import { REGISTRY_STATUSES } from "@/lib/indexer/registry";
import { getRegistryList } from "@/lib/indexer/registry";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";
import type { RegistryListResponse, RegistryStatus } from "@/lib/types/api";

export const dynamic = "force-dynamic";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** "WrittenOff", "written-off", "written_off", "active", … → RegistryStatus; "" / "all" → undefined. */
function parseStatus(raw: string | null): RegistryStatus | undefined {
  if (raw === null || raw.trim() === "" || squash(raw) === "all") return undefined;
  const match = REGISTRY_STATUSES.find((s) => squash(s) === squash(raw));
  if (!match) throw badRequest(`status must be one of ${REGISTRY_STATUSES.join(", ")}`, "VALIDATION_ERROR");
  return match;
}

const querySchema = z.object({
  cursor: z.string().regex(/^\d+$/, "cursor must come from nextCursor").optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = route(async (req: NextRequest) => {
  const params = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    cursor: params.get("cursor") || undefined,
    q: params.get("q") || undefined,
    limit: params.get("limit") || undefined,
  });
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "VALIDATION_ERROR");
  const status = parseStatus(params.get("status"));
  await syncIfStale();
  const body: RegistryListResponse = await getRegistryList({ ...parsed.data, status });
  return jsonResponse(body);
});
