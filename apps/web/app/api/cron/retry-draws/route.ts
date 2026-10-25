// GET|POST /api/cron/retry-draws: retries FAILED or stuck card draws, at most
// 3 attempts each (spec §4.4.6, §9.5). Callable by an admin session (the admin
// page triggers it on load) or with `Authorization: Bearer $CRON_SECRET`.

import { timingSafeEqual } from "node:crypto";

import { requireAdmin } from "@/lib/auth/session";
import { retryDraws } from "@/lib/card/retry";
import { env } from "@/lib/env";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";

// Each retried draw is a testnet transaction.
export const maxDuration = 120;

function hasCronSecret(req: Request): boolean {
  const secret = env().CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function sweep(req: Request): Promise<Response> {
  if (!hasCronSecret(req)) await requireAdmin();
  return jsonResponse(await retryDraws());
}

export const GET = route(sweep);
export const POST = route(sweep);
