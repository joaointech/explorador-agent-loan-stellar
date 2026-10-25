import { poolStatsResponse } from "@/lib/api/views";
import { handle, json } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await syncIfStale();
  return json(await poolStatsResponse());
});
