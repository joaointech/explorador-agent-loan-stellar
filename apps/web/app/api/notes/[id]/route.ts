// GET /api/notes/[id] (public): the SEP-50 token metadata that
// `cpcv_note.token_uri(id)` resolves to. The deploy sets the contract's
// base_uri to `${APP_URL}/api/notes` and token_uri = base_uri + "/" + id, so
// this alias serves the same JSON as GET /api/registry/[id]/metadata (name,
// description, image, attributes; no personal data).

import { route } from "@/lib/http";
import { parseNoteId } from "@/lib/indexer/note-id";
import { getNoteMetadata } from "@/lib/indexer/registry";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/notes/[id]">) => {
  const id = parseNoteId((await ctx.params).id);
  await syncIfStale();
  return jsonResponse(await getNoteMetadata(id));
});
