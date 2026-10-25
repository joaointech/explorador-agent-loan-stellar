// pnpm seed: demo data on a fresh DEMO_MODE deployment (spec §11.2). Wipes the
// previous deployment's CPCVs / card authorizations / events / snapshots, seeds
// the admin, Ana / Bruno / Carla (demo-signer smart accounts, simulated cards,
// enable_card), two investors (40,000 + 25,000 tEURC) and five CPCVs minted
// with real Groth16 proofs, with card spends, settlements and a cancellation
// spread over 120 protocol days. Ends with an indexer sync.

import { loadEnv, logger } from "./env";

loadEnv();
const log = logger("seed");

const { runSeed } = await import("@/lib/demo/seed");
const { releaseZkResources } = await import("@/lib/zk/prove");
const { explorerUrl } = await import("@/lib/stellar/explorer");
const { db } = await import("@/lib/db");

try {
  const s = await runSeed({ log });
  for (const [key, n] of Object.entries(s.notes)) {
    log(`${key} note #${n.noteId}: mint ${explorerUrl("tx", n.mintTx)}${n.settleTx ? ` · settle ${explorerUrl("tx", n.settleTx)}` : ""}${n.cancelTx ? ` · cancel ${explorerUrl("tx", n.cancelTx)}` : ""}`);
  }
  for (const a of Object.values(s.agents)) log(`${a.displayName} <${a.email}> ${a.smartAccount} · enable_card ${explorerUrl("tx", a.enableTx)}`);
  for (const i of s.investors) log(`investor ${i.address} · deposit ${explorerUrl("tx", i.txHash)}`);
} catch (err) {
  console.error("[seed] FAILED", err);
  process.exitCode = 1;
} finally {
  await releaseZkResources();
  await db.$disconnect();
}
// Lingering keep-alive sockets or prover worker threads must not keep the script alive.
process.exit(process.exitCode ?? 0);
