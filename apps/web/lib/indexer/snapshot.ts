// PoolSnapshot rows (spec §9.6): at most one per real minute, taken from the
// live `stats()` view. They feed the share-price/TVL charts and trailing APY.

import { db } from "@/lib/db";
import { readPoolStats } from "@/lib/stellar/contracts";
import type { PoolStats } from "@/lib/types/chain";

export const SNAPSHOT_INTERVAL_MS = 60_000;

/**
 * Writes a snapshot unless one was written in the last minute. `force` skips
 * the interval check: the seed script can call it between clock fast-forwards
 * so charts and trailing APY have history at several protocol dates.
 */
export async function recordPoolSnapshot(opts: { stats?: PoolStats; force?: boolean } = {}): Promise<boolean> {
  if (!opts.force) {
    const last = await db.poolSnapshot.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && Date.now() - last.createdAt.getTime() < SNAPSHOT_INTERVAL_MS) return false;
  }
  const s = opts.stats ?? (await readPoolStats());
  await db.poolSnapshot.create({
    data: {
      protocolTs: s.protocolNow,
      seniorAssets: s.seniorAssets,
      juniorAssets: s.juniorAssets,
      feesAccrued: s.feesAccrued,
      totalDebt: s.totalDebt,
      poolCash: s.poolCash,
      sharePrice: s.sharePriceScaled.toString(),
      shareSupply: s.shareSupply,
    },
  });
  return true;
}
