import type { SnapshotsResponse } from "@/lib/api-types";
import { snapshotPoints } from "@/lib/api/views";
import { handle, json } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await syncIfStale();
  const r = new URL(req.url).searchParams.get("range");
  const range = r === "30d" || r === "all" ? r : "7d";
  return json<SnapshotsResponse>({ points: await snapshotPoints(range) });
});
