// GET /api/admin/overview (admin): dashboard pool stats and alerts. Loading
// the admin dashboard also kicks the card draw retry sweep (spec §9.5), after
// the response so retries (testnet transactions) never slow the page down.

import { afterResponse } from "@/lib/admin/background";
import { getAdminOverview } from "@/lib/admin/overview";
import { requireAdmin } from "@/lib/auth/session";
import { retryDraws } from "@/lib/card/retry";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AdminOverviewResponse } from "@/lib/types/api";

// The retry sweep runs in after() within this budget (each retry is a transaction).
export const maxDuration = 120;

export const GET = route(async () => {
  await requireAdmin();
  const overview = await getAdminOverview();
  afterResponse("card draw retry sweep", async () => {
    const result = await retryDraws();
    if (result.examined > 0) console.info("[admin] card draw retry sweep", result);
  });
  return jsonResponse<AdminOverviewResponse>(overview, { headers: { "Cache-Control": "no-store" } });
});
