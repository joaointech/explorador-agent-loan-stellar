// pnpm e2e: the full flow on Stellar testnet (spec §12.1) — see lib/demo/e2e.ts.
//
// Runs against its own database (E2E_DATABASE_URL, default
// postgresql://advance:advance@localhost:5433/advance_e2e; created and migrated
// on the fly) and deploys its own fresh contracts from the uploaded wasm, so
// the seeded demo (main database, active deployment, deployments/testnet.json)
// is never touched. Exit code 1 on any failed check.

import { execFileSync } from "node:child_process";

import { ENV_FILE, REPO_ROOT, logger } from "./env";

const DEFAULT_E2E_DB = "postgresql://advance:advance@localhost:5433/advance_e2e";
const e2eUrl = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DB;
// The e2e wipes its database first: never let it point at the app's (demo) database.
{
  const { existsSync, readFileSync } = await import("node:fs");
  const { parseEnvFile } = await import("@/lib/demo/env-file");
  const appDb = existsSync(ENV_FILE) ? parseEnvFile(readFileSync(ENV_FILE, "utf8")).get("DATABASE_URL") : undefined;
  if (appDb && new URL(appDb).pathname === new URL(e2eUrl).pathname && new URL(appDb).host === new URL(e2eUrl).host) {
    console.error(`[e2e] E2E_DATABASE_URL points at the app database (${new URL(appDb).pathname.slice(1)}); use a separate one`);
    process.exit(1);
  }
}
// Set before the env file loads (loadEnvFile never overrides existing variables).
process.env.DATABASE_URL = e2eUrl;
try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // fall back to the shell environment
}
const log = logger("e2e");

const { ensureDatabase } = await import("@/lib/demo/database");
if (await ensureDatabase(e2eUrl)) log(`created database ${new URL(e2eUrl).pathname.slice(1)}`);
execFileSync("pnpm", ["--filter", "web", "exec", "prisma", "migrate", "deploy"], {
  cwd: REPO_ROOT,
  env: { ...process.env, DATABASE_URL: e2eUrl, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  stdio: ["ignore", "ignore", "inherit"],
});
log(`database ${new URL(e2eUrl).pathname.slice(1)} migrated`);

const { runE2e } = await import("@/lib/demo/e2e");
const { releaseZkResources } = await import("@/lib/zk/prove");
const { explorerUrl } = await import("@/lib/stellar/explorer");
const { db } = await import("@/lib/db");

try {
  const s = await runE2e({ log });
  console.log("\n================ e2e summary ================");
  console.log(`contracts: teurc ${s.deployment.teurc} · cpcv_note ${s.deployment.cpcvNote} · advance_pool ${s.deployment.advancePool}`);
  console.log(`agent ${s.agent.email} ${s.agent.smartAccount} · investor ${s.investor}`);
  for (const [k, v] of Object.entries(s.figures)) console.log(`${k.padEnd(12)} ${v}`);
  for (const [k, v] of Object.entries(s.txs)) console.log(`${k.padEnd(44)} ${explorerUrl("tx", v)}`);
  console.log(`XLM spent: ${Object.entries(s.xlmSpent).map(([r, v]) => `${r} ${v}`).join(", ")}`);
  console.log(`${s.checks.length} checks passed in ${Math.round(s.durationMs / 1000)} s`);
} catch (err) {
  console.error("[e2e] FAILED", err);
  process.exitCode = 1;
} finally {
  await releaseZkResources();
  await db.$disconnect();
}
process.exit(process.exitCode ?? 0);
