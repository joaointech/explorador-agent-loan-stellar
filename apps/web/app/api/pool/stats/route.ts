// GET /api/pool/stats (public): stats() + projected/trailing APY, notes by
// status, total advanced and the demo clock (spec §5.5, §9.7).

import { route } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";
import { getPoolStatsResponse } from "@/lib/pool/stats";
import type { PoolStatsResponse } from "@/lib/types/api";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await syncIfStale();
  const body: PoolStatsResponse = await getPoolStatsResponse();
  return jsonResponse(body);
});
