// POST /api/admin/junior/deposit { amountEur } (admin): treasury tops up the
// junior (first-loss) tranche: advance_pool.junior_deposit.

import { treasuryRoute } from "@/lib/admin/treasury-route";

// One testnet transaction.
export const maxDuration = 60;

export const POST = treasuryRoute("junior-deposit");
