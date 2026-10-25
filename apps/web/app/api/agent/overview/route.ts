// GET /api/agent/overview (agent): position, card, deals and activity for the
// agent app (spec §9.7, §10.2). Polled every ~10 s and after every action.
//
// Sync-on-read (spec §9.6): once lib/indexer lands, call
// `await syncIfStale(10_000)` before loading so activity includes the newest
// settlements and cancellations (the indexer owns that helper).

import { loadAgentOverview } from "@/lib/agent/overview";
import { requireAgent } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AgentOverviewResponse } from "@/lib/types/api";

export const GET = route(async () => {
  const user = await requireAgent();
  const overview = await loadAgentOverview(user.userId);
  return jsonResponse<AgentOverviewResponse>(overview, { headers: { "Cache-Control": "no-store, private" } });
});
