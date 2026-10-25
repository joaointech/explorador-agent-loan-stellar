// GET /api/agent/overview (agent): position, card, deals and activity for the
// agent app (spec §9.7, §10.2). Polled every ~10 s and after every action.
//
// Sync-on-read (spec §9.6) first, so activity includes the newest settlements
// and cancellations; an indexer hiccup must not break the overview, which has
// its own cached-position fallback.

import { loadAgentOverview } from "@/lib/agent/overview";
import { requireAgent } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";
import type { AgentOverviewResponse } from "@/lib/types/api";

export const GET = route(async () => {
  const user = await requireAgent();
  await syncIfStale(10_000).catch((err: unknown) => console.warn("indexer sync failed", err));
  const overview = await loadAgentOverview(user.userId);
  return jsonResponse<AgentOverviewResponse>(overview, { headers: { "Cache-Control": "no-store, private" } });
});
