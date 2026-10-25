// pnpm indexer — long-running indexer loop for local dev (§9.6), plus the draw retry sweep.
import "./_env";
import { syncEvents, takeSnapshot } from "../apps/web/lib/indexer/sync";
import { retryDraws } from "../apps/web/lib/lithic/asa";

const INTERVAL_MS = 5_000;
console.log(`indexer: polling every ${INTERVAL_MS / 1000}s (Ctrl-C to stop)`);
for (;;) {
  try {
    const n = await syncEvents();
    await takeSnapshot();
    const retried = await retryDraws();
    if (n || retried) console.log(`${new Date().toISOString()} events=${n} retried=${retried}`);
  } catch (e) {
    console.warn("indexer error:", e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
