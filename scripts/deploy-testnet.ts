// pnpm deploy:testnet [--skip-build] [--skip-bindings] [--no-record] [--bindings-only]
//
// Spec §7.4 / §11.1: builds the contracts (`stellar contract build`), uploads the
// three wasm files (skipped when that exact code is already on testnet; fee-bumped
// when the upload fee exceeds the uint32 cap), deploys and wires teurc, cpcv_note
// and advance_pool, mints 1,000,000 tEURC to the treasury and seeds the junior
// tranche with 10,000. Writes deployments/testnet.json and an active Deployment
// row, then regenerates the TypeScript bindings in packages/contracts-ts.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { REPO_ROOT, loadEnv, logger } from "./env";

const { values: args } = parseArgs({
  options: {
    "skip-build": { type: "boolean", default: false },
    "skip-bindings": { type: "boolean", default: false },
    "no-record": { type: "boolean", default: false },
    "bindings-only": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (args.help) {
  console.log("Usage: pnpm deploy:testnet [--skip-build] [--skip-bindings] [--no-record] [--bindings-only]");
  process.exit(0);
}

loadEnv();
const log = logger("deploy");

const { CONTRACTS, CRATE, deployContracts, recordDeployment, uploadWasm, codeStatus, wasmHash } = await import("@/lib/demo/deploy");
const { ensureXlm, formatXlm, xlmBalance } = await import("@/lib/demo/accounts");
const { adminKeypair } = await import("@/lib/stellar/config");
const { explorerUrl } = await import("@/lib/stellar/explorer");
const { db } = await import("@/lib/db");

const CONTRACTS_DIR = path.join(REPO_ROOT, "contracts");
const WASM_DIR = path.join(CONTRACTS_DIR, "target", "wasm32v1-none", "release");
const BINDINGS_DIR = path.join(REPO_ROOT, "packages", "contracts-ts");
const DEPLOYMENT_FILE = path.join(REPO_ROOT, "deployments", "testnet.json");

/** Runs the stellar CLI without our STELLAR_* app variables (the CLI reads env vars of the same names). */
function stellar(argv: string[], cwd: string) {
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("STELLAR_")));
  execFileSync("stellar", argv, { cwd, stdio: ["ignore", "inherit", "inherit"], env: childEnv });
}

/** `stellar contract bindings typescript` from the local wasm (no network needed; contract ids live in deployments/testnet.json). */
function generateBindings() {
  for (const k of CONTRACTS) {
    const out = path.join(BINDINGS_DIR, CRATE[k]);
    stellar(["contract", "bindings", "typescript", "--wasm", path.join(WASM_DIR, `${CRATE[k]}.wasm`), "--output-dir", out, "--overwrite"], REPO_ROOT);
  }
  log(`TypeScript bindings regenerated in ${path.relative(REPO_ROOT, BINDINGS_DIR)}/{${CONTRACTS.map((k) => CRATE[k]).join(",")}}`);
}

async function main() {
  const admin = adminKeypair().publicKey();

  if (!args["skip-build"]) {
    log("building contracts (stellar contract build)…");
    stellar(["contract", "build"], CONTRACTS_DIR);
  }
  if (args["bindings-only"]) return generateBindings();

  const wasm = Object.fromEntries(CONTRACTS.map((k) => [k, readFileSync(path.join(WASM_DIR, `${CRATE[k]}.wasm`))])) as Record<
    (typeof CONTRACTS)[number],
    Buffer
  >;
  const missing: string[] = [];
  for (const k of CONTRACTS) if ((await codeStatus(wasmHash(wasm[k]))) !== "live") missing.push(CRATE[k]);

  // Uploads currently cost several hundred XLM each; deploys and wiring tens.
  const before = await ensureXlm(admin, missing.length ? 2_500 * missing.length : 400, log);
  log(`admin ${admin} holds ${formatXlm(before)}${missing.length ? `; uploading ${missing.join(", ")}` : "; all wasm already uploaded"}`);

  const wasmHashes = {} as Record<(typeof CONTRACTS)[number], string>;
  for (const k of CONTRACTS) wasmHashes[k] = (await uploadWasm(CRATE[k], wasm[k], log)).hash;

  const result = await deployContracts({ wasmHashes, log });
  if (!args["no-record"]) {
    await recordDeployment(result, { file: DEPLOYMENT_FILE });
    log(`active Deployment row written; ${path.relative(REPO_ROOT, DEPLOYMENT_FILE)} updated`);
  }

  if (!args["skip-bindings"]) generateBindings();

  const after = await xlmBalance(admin);
  log(`admin spent ${formatXlm(before - after)} (now ${formatXlm(after)})`);
  for (const k of CONTRACTS) log(`${CRATE[k].padEnd(13)} ${result[k]}  ${explorerUrl("contract", result[k])}`);
  for (const [step, hash] of Object.entries(result.txs)) log(`${step.padEnd(36)} ${explorerUrl("tx", hash)}`);
}

try {
  await main();
} catch (err) {
  console.error("[deploy] FAILED", err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
