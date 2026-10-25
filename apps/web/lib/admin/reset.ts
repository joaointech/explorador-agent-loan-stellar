// "Reset demo" (spec §11.1–11.2): streams the progress of `runDemoReset`
// (redeploy from the stored wasm hashes + reseed, owned by the deploy/seed
// workstream) as ResetLogEvents. Demo deployments only; one reset at a time
// per server process.

import { runDemoReset } from "@/lib/demo/reset";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { ResetLogEvent } from "@/lib/types/api";

import { shortMessage } from "./chain-errors";
import { sseStream, type SseStream } from "./sse";

let running = false;

export const isResetRunning = () => running;

export function startDemoReset(): SseStream {
  if (!env().DEMO_MODE) throw new HttpError(409, "DEMO_MODE_DISABLED", "Reset demo is only available on demo deployments (DEMO_MODE=true)");
  if (running) throw new HttpError(409, "RESET_RUNNING", "A demo reset is already running");
  running = true;

  return sseStream<ResetLogEvent>(async (writer) => {
    let finished = false;
    const log = (event: ResetLogEvent) => {
      if (event.level === "done") finished = true;
      writer.send(event);
    };
    try {
      log({ level: "info", message: "Starting the demo reset: redeploying the contracts and reseeding demo data" });
      await runDemoReset(log);
      if (!finished) log({ level: "done", message: "Demo reset complete" });
    } catch (err) {
      console.error("[admin] demo reset failed", err);
      log({ level: "error", message: `Reset failed: ${shortMessage(err)}` });
    } finally {
      running = false;
    }
  });
}
