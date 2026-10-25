import { handle, json } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";
import { investorPosition } from "@/lib/investor";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ address: string }> }) => {
  await syncIfStale(5_000);
  return json(await investorPosition((await ctx.params).address));
});
