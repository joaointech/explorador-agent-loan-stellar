// GET /api/cron/sync: one indexing pass (spec §9.6), for Vercel Cron or a
// manual poke. Public: the pass is idempotent and only reads from the chain.

import { route } from "@/lib/http";
import { runSync } from "@/lib/indexer/sync";
import { errorResponse, jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async () => {
  const result = await runSync();
  if (result.status === "error") return errorResponse(502, "SYNC_FAILED", result.reason ?? "sync failed");
  return jsonResponse(result);
});
