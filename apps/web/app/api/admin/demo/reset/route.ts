import type { DemoResetEvent } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { handle, HttpError, sseStream } from "@/lib/http";
import { resetDemo } from "@/lib/ops/reset";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

/** Redeploy + reseed with SSE progress lines (same code as `pnpm demo:reset`). */
export const POST = handle(async () => {
  await requireAdmin();
  if (!env.demoMode) throw new HttpError(403, "DEMO_MODE_DISABLED", "Reset is only available on demo deployments");
  if (running) throw new HttpError(409, "RESET_RUNNING", "A reset is already running");
  running = true;
  return sseStream(async (send) => {
    const line = (l: string) => send({ line: l } satisfies DemoResetEvent);
    try {
      await resetDemo(line);
      send({ line: "Done", done: true } satisfies DemoResetEvent);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      send({ line: `Failed: ${message}`, error: message } satisfies DemoResetEvent);
    } finally {
      running = false;
    }
  });
});
