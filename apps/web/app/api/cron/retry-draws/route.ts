import { assertCron } from "@/lib/cron";
import { handle, json } from "@/lib/http";
import { retryDraws } from "@/lib/lithic/asa";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  assertCron(req);
  return json({ ok: true, retried: await retryDraws() });
});
