// GET  /api/admin/cpcv (admin): every CPCV with its PII decrypted, newest first.
// POST /api/admin/cpcv (admin): create a CPCV, prove it and mint its note,
//      streaming PipelineEvents as Server-Sent Events (spec §4.3, §9.7).
//      Auth and body-shape errors are plain JSON errors before the stream starts.

import { requireAdmin } from "@/lib/auth/session";
import { keepAlive } from "@/lib/admin/background";
import { adminCpcvInputSchema } from "@/lib/admin/cpcv-input";
import { listAdminCpcvs } from "@/lib/admin/cpcvs";
import { requireAdminMutation } from "@/lib/admin/guard";
import { runCpcvPipeline } from "@/lib/admin/pipeline";
import { sseStream } from "@/lib/admin/sse";
import { parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminCpcvListResponse, PipelineEvent } from "@/lib/types/api";

// snarkjs proving needs Node (worker threads, fs for the circuit artifacts).
export const runtime = "nodejs";
// Proof ~1 s + a testnet mint transaction (spec §8.6).
export const maxDuration = 60;

export const GET = route(async () => {
  await requireAdmin();
  return jsonResponse<AdminCpcvListResponse>(await listAdminCpcvs(), { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (req: Request) => {
  await requireAdminMutation(req);
  const input = await parseBody(req, adminCpcvInputSchema);
  const { response, done } = sseStream<PipelineEvent>(async (writer) => {
    await runCpcvPipeline(input, (event) => writer.send(event));
  });
  // Finish (and record) the pipeline even if the admin closes the tab.
  keepAlive(done);
  return response;
});
