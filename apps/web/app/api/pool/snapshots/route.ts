// GET /api/pool/snapshots?range=7d|30d|all (public): share price + TVL series
// on the protocol clock.

import type { NextRequest } from "next/server";
import { z } from "zod";

import { badRequest, route } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";
import { getSnapshotsResponse, SNAPSHOT_RANGES, type SnapshotRange } from "@/lib/pool/stats";
import type { PoolSnapshotsResponse } from "@/lib/types/api";

export const dynamic = "force-dynamic";

const rangeSchema = z.enum(Object.keys(SNAPSHOT_RANGES) as [SnapshotRange, ...SnapshotRange[]]).default("7d");

export const GET = route(async (req: NextRequest) => {
  const range = rangeSchema.safeParse(req.nextUrl.searchParams.get("range") ?? undefined);
  if (!range.success) throw badRequest("range must be one of 7d, 30d, all", "VALIDATION_ERROR");
  await syncIfStale();
  const body: PoolSnapshotsResponse = await getSnapshotsResponse(range.data);
  return jsonResponse(body);
});
