// A card authorization is only a hold: Lithic shows the transaction as PENDING
// until the merchant clears (captures) it, and in the sandbox nothing clears
// on its own. Once our on-chain draw has confirmed, we play the merchant and
// clear it, so the Lithic transaction settles for the authorized amount.
// Best-effort: a failed clearing never affects the draw, which already landed.

import { isSimulatedToken } from "@/lib/card/simulated-network";
import { lithicEnabled } from "@/lib/lithic/client";
import { simulateClearing } from "@/lib/lithic/simulate";

export type ClearingOutcome = "cleared" | "skipped" | "failed";

/** Clears a Lithic sandbox authorization; skips simulated-network purchases. */
export async function clearLithicAuthorization(lithicToken: string): Promise<ClearingOutcome> {
  if (!lithicEnabled() || isSimulatedToken(lithicToken)) return "skipped";
  try {
    await simulateClearing(lithicToken);
    console.info(`[card] Lithic transaction ${lithicToken} cleared`);
    return "cleared";
  } catch (err) {
    console.warn(`[card] clearing Lithic transaction ${lithicToken} failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}
