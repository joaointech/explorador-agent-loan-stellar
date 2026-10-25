// GET /api/agent/card/authorizations/[id] (agent): status of a purchase's
// on-chain draw, polled by the UI until CONFIRMED or FAILED.

import { after } from "next/server";

import { requireAgent } from "@/lib/auth/session";
import { getAuthorizationStatus } from "@/lib/card/authorization";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AuthorizationStatusResponse } from "@/lib/types/api";

// A lost draw is re-armed in after().
export const maxDuration = 60;

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/agent/card/authorizations/[id]">) => {
  const user = await requireAgent();
  const { id } = await ctx.params;
  const { status, followUp } = await getAuthorizationStatus(user.userId, id);
  if (followUp) after(followUp);
  return jsonResponse<AuthorizationStatusResponse>(status, { headers: { "Cache-Control": "no-store" } });
});
