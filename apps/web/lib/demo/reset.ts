// "Reset demo" (spec §9.7 POST /api/admin/demo/reset, §11.1 `pnpm demo:reset`):
// redeploys fresh contract instances from the stored wasm hashes (no upload),
// makes them the active deployment, wipes the previous deployment's demo data
// and reseeds (lib/demo/seed.ts). Progress streams through `log`.
//
// Non-seed users are kept (users, passkeys, Agent rows and their smart
// accounts, which don't depend on our contracts); their CPCVs and card
// authorizations belonged to the old contracts and are deleted, and
// `cardEnabledOnChain` is reset: they activate the card again on the new pool.
//
// Duration: ~1 minute of deploys + ~2-3 minutes of seeding on testnet, inside
// the route's `maxDuration = 300`. The deployer and fee payers are topped up
// with Friendbot when low (fees are very high on today's testnet).

import type { ResetLogEvent } from "@/lib/types/api";

import { deployContracts, recordDeployment, storedWasmHashes } from "./deploy";
import { runSeed, type SeedSummary } from "./seed";

export interface DemoResetOptions {
  /** Also write deployments/testnet.json (local `pnpm demo:reset`; serverless file systems are read-only). */
  deploymentFile?: string;
}

/** Redeploys the contracts from the stored wasm hashes and reseeds demo data, reporting progress through `log`. */
export async function runDemoReset(log: (event: ResetLogEvent) => void, opts: DemoResetOptions = {}): Promise<SeedSummary> {
  const started = Date.now();
  const info = (message: string) => log({ level: "info", message });
  try {
    info("Redeploying the contracts from the stored wasm hashes…");
    const wasmHashes = await storedWasmHashes();
    const deployment = await deployContracts({ wasmHashes, log: info });
    await recordDeployment(deployment, { file: opts.deploymentFile });
    info(`New deployment active: pool ${deployment.advancePool}, notes ${deployment.cpcvNote}, tEURC ${deployment.teurc}`);
    info("Seeding demo data…");
    const summary = await runSeed({ log: info });
    log({ level: "done", message: `Demo reset complete in ${Math.round((Date.now() - started) / 1000)} s` });
    return summary;
  } catch (err) {
    log({ level: "error", message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
