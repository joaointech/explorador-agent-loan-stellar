// pnpm --filter @advance/scripts fund [--operator <xlm>] [--sponsor <xlm>] [--admin <xlm>] [--treasury <xlm>]
//
// Tops the role accounts up to at least the given XLM balance by merging fresh
// Friendbot accounts (10,000 XLM each) into them. Testnet fees swing: while
// they spiked (2026-10-25) a cpcv_note.mint cost ~1,000 XLM and a card_draw
// ~50-100 XLM for the operator, an agent's first transaction ~150 XLM for the
// sponsor; at normal levels they cost fractions of an XLM.

import { parseArgs } from "node:util";

import { loadEnv, logger } from "./env";

const { values: args } = parseArgs({
  options: {
    operator: { type: "string", default: "30000" },
    sponsor: { type: "string", default: "10000" },
    admin: { type: "string", default: "5000" },
    treasury: { type: "string", default: "1000" },
  },
});

loadEnv();
const log = logger("fund");
const { ensureXlm, formatXlm } = await import("@/lib/demo/accounts");
const { roleKeypair } = await import("@/lib/stellar/config");

const roles = { operator: "OPERATOR_SECRET", sponsor: "SPONSOR_SECRET", admin: "ADMIN_SECRET", treasury: "TREASURY_SECRET" } as const;
try {
  for (const [role, secret] of Object.entries(roles)) {
    const target = Number(args[role as keyof typeof roles]);
    if (!Number.isFinite(target) || target <= 0) continue;
    const address = roleKeypair(secret).publicKey();
    const balance = await ensureXlm(address, target, (m) => log(`${role}: ${m}`));
    log(`${role.padEnd(9)} ${address} ${formatXlm(balance)}`);
  }
} catch (err) {
  console.error("[fund] FAILED", err);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
