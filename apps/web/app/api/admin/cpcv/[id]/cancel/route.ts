// POST /api/admin/cpcv/[id]/cancel (admin): "Cancel (buyer withdrew)" (spec §4.6).
// advance_pool.cancel(note_id) as operator → CANCELLED; the note's debt
// becomes the agent's carried debt and the grace period starts.

import { cancelCpcv } from "@/lib/admin/actions";
import { requireAdminMutation } from "@/lib/admin/guard";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminCpcvActionResponse } from "@/lib/types/api";

// One testnet transaction.
export const maxDuration = 60;

export const POST = route(async (req: Request, ctx: RouteContext<"/api/admin/cpcv/[id]/cancel">) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  return jsonResponse<AdminCpcvActionResponse>(await cancelCpcv(id));
});
