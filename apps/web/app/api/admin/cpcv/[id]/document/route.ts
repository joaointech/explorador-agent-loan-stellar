// GET /api/admin/cpcv/[id]/document (admin): the signed CPCV PDF uploaded with
// this CPCV, decrypted and shown inline ("View PDF"). Personal data: never
// cached, never exposed by the registry or any public route.

import { requireAdmin } from "@/lib/auth/session";
import { pdfResponse, readLinkedCpcvPdf } from "@/lib/admin/cpcv-documents";
import { route } from "@/lib/http";

// Node: AES-256-GCM decryption with node:crypto.
export const runtime = "nodejs";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/admin/cpcv/[id]/document">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { fileName, bytes } = await readLinkedCpcvPdf(id);
  return pdfResponse(fileName, bytes);
});
