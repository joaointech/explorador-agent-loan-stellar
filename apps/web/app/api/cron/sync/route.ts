import { assertCron } from "@/lib/cron";
import { handle, json } from "@/lib/http";
import { syncEvents, takeSnapshot } from "@/lib/indexer/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  assertCron(req);
  const events = await syncEvents();
  await takeSnapshot();
  return json({ ok: true, events });
});
