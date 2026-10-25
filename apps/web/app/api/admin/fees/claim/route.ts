// POST /api/admin/fees/claim { amountEur } (admin): treasury claims protocol
// fees (10% of interest): advance_pool.claim_fees (≤ fees accrued, ≤ pool cash).

import { treasuryRoute } from "@/lib/admin/treasury-route";

// One testnet transaction.
export const maxDuration = 60;

export const POST = treasuryRoute("claim-fees");
