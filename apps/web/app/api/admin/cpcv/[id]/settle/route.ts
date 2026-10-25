import type { TxResponse } from "@/lib/api-types";
import { settleCpcv } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";

export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  return json<TxResponse>(await settleCpcv((await ctx.params).id));
});
