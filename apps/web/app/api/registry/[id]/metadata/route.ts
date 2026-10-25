import { noteMetadata, registryNote } from "@/lib/api/views";
import { handle, HttpError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "VALIDATION", "Invalid note id");
  const { dto } = await registryNote(id);
  return json(noteMetadata(dto), { headers: { "access-control-allow-origin": "*" } });
});
