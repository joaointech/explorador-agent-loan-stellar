// POST /api/admin/agents/[id]/write-off (admin): advance_pool.write_off(agent)
// once the grace deadline has passed (spec §4.6). The loss hits junior first,
// then senior; the agent is blocked; their cancelled CPCVs become WRITTEN_OFF.

import { writeOffAgent } from "@/lib/admin/actions";
import { requireAdminMutation } from "@/lib/admin/guard";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminWriteOffResponse } from "@/lib/types/api";

// One testnet transaction.
export const maxDuration = 60;

export const POST = route(async (req: Request, ctx: RouteContext<"/api/admin/agents/[id]/write-off">) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  return jsonResponse<AdminWriteOffResponse>(await writeOffAgent(id));
});
