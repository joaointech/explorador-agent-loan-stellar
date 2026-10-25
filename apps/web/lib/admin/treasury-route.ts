// Handler shared by POST /api/admin/junior/deposit, /junior/withdraw and
// /fees/claim: `{ amountEur }` → a treasury-signed pool transaction.

import { parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { TxResponse } from "@/lib/types/api";

import { runTreasuryAction, type TreasuryAction } from "./actions";
import { requireAdminMutation } from "./guard";
import { amountEurSchema } from "./schemas";

export function treasuryRoute(action: TreasuryAction) {
  return route(async (req: Request) => {
    await requireAdminMutation(req);
    const { amountEur } = await parseBody(req, amountEurSchema);
    return jsonResponse<TxResponse>(await runTreasuryAction(action, amountEur));
  });
}
