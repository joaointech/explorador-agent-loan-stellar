import { z } from "zod";
import type { TxResponse } from "@/lib/api-types";
import { treasuryCall } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/http";

export const maxDuration = 60;

const Body = z.object({ amountEur: z.number().positive().max(10_000_000) });

export const POST = handle(async (req: Request) => {
  await requireAdmin();
  const { amountEur } = await parseBody(req, Body);
  return json<TxResponse>(await treasuryCall("junior_withdraw", amountEur));
});
