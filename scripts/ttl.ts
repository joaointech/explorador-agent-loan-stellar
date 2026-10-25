// pnpm --filter @advance/scripts ttl [--extend-days <n>] [--code-only] [--dry-run]
//
// Shows how long the active deployment's contract code and instances stay live
// on testnet and, with --extend-days, extends them (admin-paid, fee-bumped,
// topped up with Friendbot). Contracts extend their own instance + code to ~30
// days once below ~15 days; while testnet fees spike the code part costs
// thousands of XLM, so pre-extending keeps that bill away from card draws.

import { parseArgs } from "node:util";

import { loadEnv, logger } from "./env";

const { values: args } = parseArgs({
  options: {
    "extend-days": { type: "string" },
    "code-only": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

loadEnv();
const log = logger("ttl");
const { codeEntry, extendTtls, instanceEntry, readTtls } = await import("@/lib/demo/ttl");
const { CONTRACTS, CRATE } = await import("@/lib/demo/deploy");
const { requireDeployment } = await import("@/lib/stellar/deployment");
const { adminKeypair } = await import("@/lib/stellar/config");
const { explorerUrl } = await import("@/lib/stellar/explorer");
const { db } = await import("@/lib/db");

try {
  const d = await requireDeployment();
  const hashes = d.wasmHashes as Record<string, string>;
  const entries = [
    ...CONTRACTS.map((k) => codeEntry(`code ${CRATE[k]}`, hashes[k])),
    ...(args["code-only"] ? [] : CONTRACTS.map((k) => instanceEntry(`instance ${CRATE[k]}`, d.info[k]))),
  ];
  const show = async () => {
    const t = await readTtls(entries);
    for (const e of t.entries) log(`${e.label.padEnd(22)} ${e.daysLeft === null ? "missing" : `${e.daysLeft.toFixed(1)} days left`} (${e.sizeBytes} bytes)`);
  };
  await show();
  if (args["extend-days"]) {
    const days = Number(args["extend-days"]);
    if (!Number.isFinite(days) || days <= 0) throw new Error("--extend-days must be a positive number");
    const res = await extendTtls(entries, days, adminKeypair(), log, { dryRun: args["dry-run"] });
    if (res.txHash) {
      log(`extended: ${explorerUrl("tx", res.txHash)}`);
      await show();
    } else {
      log("dry run: nothing submitted");
    }
  }
} catch (err) {
  console.error("[ttl] FAILED", err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
