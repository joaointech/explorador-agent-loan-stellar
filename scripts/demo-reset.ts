// pnpm demo:reset: the admin panel's "Reset demo" from the command line (spec
// §11.1): redeploys fresh contracts from the stored wasm hashes (no upload),
// wipes the previous deployment's demo data and reseeds. Also updates
// deployments/testnet.json. Run `pnpm deploy:testnet` instead after changing
// a contract (new wasm) or after a testnet reset (code gone).

import path from "node:path";

import { REPO_ROOT, loadEnv, logger } from "./env";

loadEnv();
const log = logger("reset");

const { runDemoReset } = await import("@/lib/demo/reset");
const { releaseZkResources } = await import("@/lib/zk/prove");
const { db } = await import("@/lib/db");

try {
  await runDemoReset(
    (e) => {
      if (e.level === "error") console.error(`[reset] ERROR ${e.message}`);
      else log(e.message);
    },
    { deploymentFile: path.join(REPO_ROOT, "deployments", "testnet.json") },
  );
} catch (err) {
  console.error("[reset] FAILED", err);
  process.exitCode = 1;
} finally {
  await releaseZkResources();
  await db.$disconnect();
}
// Lingering keep-alive sockets or prover worker threads must not keep the script alive.
process.exit(process.exitCode ?? 0);
