// POST /api/admin/cpcv/[id]/settle (admin): "Confirm escritura" (spec §4.5).
// advance_pool.settle(note_id), signed by operator + treasury → SETTLED.

import { settleCpcv } from "@/lib/admin/actions";
import { requireAdminMutation } from "@/lib/admin/guard";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminCpcvActionResponse } from "@/lib/types/api";

// One testnet transaction.
export const maxDuration = 60;

export const POST = route(async (req: Request, ctx: RouteContext<"/api/admin/cpcv/[id]/settle">) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  return jsonResponse<AdminCpcvActionResponse>(await settleCpcv(id));
});
