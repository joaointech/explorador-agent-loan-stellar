import { registryDetail } from "@/lib/api/views";
import { handle, HttpError, json } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";

export const dynamic = "force-dynamic";

/** Note detail; also serves as the SEP-50 token_uri (name/description/attributes at the top level). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "VALIDATION", "Invalid note id");
  await syncIfStale();
  return json(await registryDetail(id), { headers: { "access-control-allow-origin": "*" } });
});
