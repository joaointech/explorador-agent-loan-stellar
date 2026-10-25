import type { InvestorPreviewResponse } from "@/lib/api-types";
import { handle, HttpError, json } from "@/lib/http";
import { preview } from "@/lib/investor";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const action = sp.get("action");
  if (action !== "deposit" && action !== "withdraw" && action !== "redeem") throw new HttpError(400, "VALIDATION", "action must be deposit, withdraw or redeem");
  const raw = sp.get("amount") ?? "0";
  if (!/^\d{1,30}$/.test(raw)) throw new HttpError(400, "VALIDATION", "amount must be an integer number of stroops");
  const amount = BigInt(raw);
  const result = amount > 0n ? await preview(action, amount) : 0n;
  return json<InvestorPreviewResponse>({ action, amount: amount.toString(), result: BigInt(result).toString() });
});
