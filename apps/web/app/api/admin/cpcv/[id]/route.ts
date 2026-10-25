import { getCpcv } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  return json(await getCpcv((await ctx.params).id));
});
