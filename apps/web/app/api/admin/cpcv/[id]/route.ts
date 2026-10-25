// GET /api/admin/cpcv/[id] (admin): one CPCV with decrypted PII, its proof
// (snarkjs format + public signals), commitment, nullifier and salt, plus the
// live credit line and agent position for the settle/cancel previews.

import { requireAdmin } from "@/lib/auth/session";
import { getAdminCpcvDetail } from "@/lib/admin/cpcvs";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminCpcvDetailResponse } from "@/lib/types/api";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/admin/cpcv/[id]">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return jsonResponse<AdminCpcvDetailResponse>(await getAdminCpcvDetail(id), { headers: { "Cache-Control": "no-store" } });
});
