// Short-lived shared cache of `advance_pool.stats()` for read routes, so a
// page that hits several endpoints triggers one simulation.

import { readPoolStats } from "@/lib/stellar/contracts";
import { requireDeployment } from "@/lib/stellar/deployment";
import type { PoolStats } from "@/lib/types/chain";

const TTL_MS = 3_000;

type Entry = { key: string; at: number; stats: PoolStats };
const g = globalThis as unknown as { advanceStats?: Entry; advanceStatsInflight?: { key: string; promise: Promise<PoolStats> } };

/** Pool stats at most 3 s old (in-flight reads are shared). */
export async function getPoolStatsCached(): Promise<PoolStats> {
  const { key } = await requireDeployment();
  const cached = g.advanceStats;
  if (cached && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.stats;
  if (g.advanceStatsInflight?.key === key) return g.advanceStatsInflight.promise;
  const promise = readPoolStats()
    .then((stats) => {
      g.advanceStats = { key, at: Date.now(), stats };
      return stats;
    })
    .finally(() => {
      if (g.advanceStatsInflight?.promise === promise) g.advanceStatsInflight = undefined;
    });
  g.advanceStatsInflight = { key, promise };
  return promise;
}
