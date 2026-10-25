// pnpm keys:generate [--force] [--app-url <url>] [--admin-emails <list>] [--database-url <url>] [--no-fund] [--out <path>]
//
// Spec §11.1: creates the admin / operator / treasury / sponsor keypairs and the
// card-settlement address, funds them with Friendbot, generates the BabyJubJub
// attester key, NULLIFIER_SECRET, PII_ENCRYPTION_KEY, SESSION_SECRET and
// DEMO_SIGNER_SEED, and merges everything into apps/web/.env.local (created from
// .env.example when missing). Values that are already set are kept unless --force.
// --out writes another file instead (e.g. a production env destined for
// Secrets Manager); only that file is loaded, so local keys never leak into it.

import path from "node:path";
import { parseArgs } from "node:util";

import { ENV_FILE, WEB_DIR, loadEnv, logger } from "./env";

const { values: args } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    "app-url": { type: "string" },
    "admin-emails": { type: "string" },
    "database-url": { type: "string" },
    "no-fund": { type: "boolean", default: false },
    out: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (args.help) {
  console.log("Usage: pnpm keys:generate [--force] [--app-url <url>] [--admin-emails <list>] [--database-url <url>] [--no-fund] [--out <path>]");
  process.exit(0);
}

const envPath = args.out ? path.resolve(args.out) : ENV_FILE;
loadEnv(envPath);
const log = logger("keys");
const { generateKeys } = await import("@/lib/demo/keys");

const result = await generateKeys({
  envPath,
  templatePath: path.join(WEB_DIR, ".env.example"),
  force: args.force,
  appUrl: args["app-url"],
  adminEmails: args["admin-emails"],
  databaseUrl: args["database-url"],
  fund: !args["no-fund"],
  log,
});

log(`wrote ${envPath}`);
if (result.set.length) log(`set: ${result.set.join(", ")}`);
if (result.kept.length) log(`kept (already set; --force to replace): ${result.kept.join(", ")}`);
for (const [role, address] of Object.entries(result.accounts)) log(`${role.padEnd(14)} ${address}`);
log(result.funded.length ? `funded with Friendbot: ${result.funded.join(", ")}` : "all accounts already existed");
