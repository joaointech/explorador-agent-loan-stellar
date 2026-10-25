// GET /api/investor/[address] (public): eaSR shares, value, max withdraw and
// deposit/withdraw history from indexed SEP-56 events (spec §9.7).

import { StrKey } from "@stellar/stellar-sdk";

import { badRequest, route } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";
import { jsonResponse } from "@/lib/json";
import { getInvestorResponse } from "@/lib/pool/investor";
import type { InvestorResponse } from "@/lib/types/api";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/investor/[address]">) => {
  const address = (await ctx.params).address.trim();
  if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) {
    throw badRequest("address must be a Stellar account (G…) or contract (C…) address", "INVALID_ADDRESS");
  }
  await syncIfStale();
  const body: InvestorResponse = await getInvestorResponse(address);
  return jsonResponse(body);
});
