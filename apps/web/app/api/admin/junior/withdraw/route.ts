// POST /api/admin/junior/withdraw { amountEur } (admin): treasury takes capital
// out of the junior tranche: advance_pool.junior_withdraw (≤ junior, ≤ idle
// liquidity, and debt stays ≤ 10 × junior afterwards).

import { treasuryRoute } from "@/lib/admin/treasury-route";

// One testnet transaction.
export const maxDuration = 60;

export const POST = treasuryRoute("junior-withdraw");
