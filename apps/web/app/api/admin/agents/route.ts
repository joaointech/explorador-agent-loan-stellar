// GET /api/admin/agents (admin): every agent with smart account, card, notes
// and their live on-chain position (debt, carried debt, grace deadline,
// blocked, whether write-off is available).

import { listAdminAgents } from "@/lib/admin/agents";
import { readDemoClock } from "@/lib/admin/clock";
import { requireAdmin } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminAgentsResponse } from "@/lib/types/api";

export const GET = route(async () => {
  await requireAdmin();
  const clock = await readDemoClock();
  return jsonResponse<AdminAgentsResponse>({ agents: await listAdminAgents(clock), clock }, { headers: { "Cache-Control": "no-store" } });
});
