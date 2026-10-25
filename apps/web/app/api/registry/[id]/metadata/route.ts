// GET /api/registry/[id]/metadata (public): SEP-50 token metadata JSON that
// `cpcv_note.token_uri(id)` points at (name, description, image, attributes;
// no personal data).

import { route } from "@/lib/http";
import { parseNoteId } from "@/lib/indexer/note-id";
import { getNoteMetadata } from "@/lib/indexer/registry";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/registry/[id]/metadata">) => {
  const id = parseNoteId((await ctx.params).id);
  await syncIfStale();
  return jsonResponse(await getNoteMetadata(id));
});
