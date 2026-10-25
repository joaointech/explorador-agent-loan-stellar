// Interface owned by the Deploy, seed & e2e workstream (spec §11.1–11.2).
// Shared by `POST /api/admin/demo/reset` and `pnpm demo:reset`.

import { notImplemented } from "@/lib/http";
import type { ResetLogEvent } from "@/lib/types/api";

/** Redeploys the contracts from the stored wasm hashes and reseeds demo data, reporting progress through `log`. */
export async function runDemoReset(_log: (event: ResetLogEvent) => void): Promise<void> {
  notImplemented("runDemoReset", "deploy, seed & e2e");
}
