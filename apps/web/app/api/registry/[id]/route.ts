// GET /api/registry/[id] (public): note detail, events timeline, proof in
// snarkjs format and public signals. No personal data (spec §9.7).

import { route } from "@/lib/http";
import { parseNoteId } from "@/lib/indexer/note-id";
import { getRegistryDetail } from "@/lib/indexer/registry";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";
import type { RegistryDetailResponse } from "@/lib/types/api";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/registry/[id]">) => {
  const id = parseNoteId((await ctx.params).id);
  await syncIfStale();
  const body: RegistryDetailResponse = await getRegistryDetail(id);
  return jsonResponse(body);
});
