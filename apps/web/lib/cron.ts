import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; without a secret the endpoint is open (dev). */
export function assertCron(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return;
  if (req.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "UNAUTHORIZED", "Bad cron secret");
}
