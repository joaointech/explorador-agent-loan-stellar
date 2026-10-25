// POST /api/admin/demo/reset (admin, DEMO_MODE only): redeploy from the stored
// wasm hashes and reseed (spec §11.1), streaming ResetLogEvents as
// Server-Sent Events.

import { keepAlive } from "@/lib/admin/background";
import { requireAdminMutation } from "@/lib/admin/guard";
import { startDemoReset } from "@/lib/admin/reset";
import { route } from "@/lib/http";

// Deploys contracts and runs the seed (proofs, mints, draws, clock moves).
export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = route(async (req: Request) => {
  await requireAdminMutation(req);
  const { response, done } = startDemoReset();
  keepAlive(done);
  return response;
});
