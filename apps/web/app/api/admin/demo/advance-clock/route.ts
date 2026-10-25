import { z } from "zod";
import type { TxResponse } from "@/lib/api-types";
import { advanceClock } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/http";
import { takeSnapshot } from "@/lib/indexer/sync";

export const maxDuration = 60;

const Body = z.union([z.object({ days: z.number().int().min(1).max(400) }), z.object({ toGraceOf: z.string().min(1) })]);

export const POST = handle(async (req: Request) => {
  await requireAdmin();
  const body = await parseBody(req, Body);
  const r = await advanceClock(body);
  await takeSnapshot(true).catch(() => undefined);
  return json<TxResponse>(r);
});
