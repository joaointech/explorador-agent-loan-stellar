// `pnpm keys:generate` (spec §11.1): role keypairs funded with Friendbot, the
// BabyJubJub attester key, the nullifier secret and the app secrets, merged
// into apps/web/.env.local without overwriting values that are already set
// (unless `force`). Only CARD_SETTLEMENT's public key is stored: it just
// receives tEURC.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { Keypair } from "@stellar/stellar-sdk";

import { generateAttesterKey, generateNullifierSecret } from "@/lib/zk/keys";

import { ensureFunded, type Log } from "./accounts";
import { mergeEnvFile, parseEnvFile } from "./env-file";

/**
 * Seeded admin (spec §11.2 "first ADMIN_EMAILS"): a demo-domain address (never emailed). In DEMO_MODE
 * its sign-in code is printed in the server console, and shown on the sign-in page only with the
 * DEMO_ADMIN_SIGNIN=true opt-in (which lets anyone become admin).
 */
export const DEFAULT_ADMIN_EMAIL = "admin@demo.explorador.pt";
/** Placeholder in .env.example that should not survive into a generated file. */
const PLACEHOLDER_ADMIN = "you@explorador.ai";

const ROLE_SECRETS = ["ADMIN_SECRET", "OPERATOR_SECRET", "TREASURY_SECRET", "SPONSOR_SECRET"] as const;

export interface GenerateKeysOptions {
  envPath: string;
  /** Template used when `envPath` does not exist (apps/web/.env.example). */
  templatePath: string;
  force?: boolean;
  appUrl?: string;
  adminEmails?: string;
  databaseUrl?: string;
  /** Skip Friendbot (offline runs and tests). */
  fund?: boolean;
  log?: Log;
}

export interface GenerateKeysResult {
  set: string[];
  kept: string[];
  accounts: Record<string, string>;
  funded: string[];
}

const hex32 = () => randomBytes(32).toString("hex");

export async function generateKeys(opts: GenerateKeysOptions): Promise<GenerateKeysResult> {
  const log = opts.log ?? (() => {});
  const fromFile = existsSync(opts.envPath);
  const text = fromFile ? readFileSync(opts.envPath, "utf8") : existsSync(opts.templatePath) ? readFileSync(opts.templatePath, "utf8") : "";
  const current = fromFile ? parseEnvFile(text) : new Map<string, string>();
  const keep = (key: string) => !opts.force && Boolean(current.get(key));

  const values: Record<string, string> = {};
  for (const key of ROLE_SECRETS) values[key] = keep(key) ? current.get(key)! : Keypair.random().secret();
  values.CARD_SETTLEMENT_PUBLIC = keep("CARD_SETTLEMENT_PUBLIC") ? current.get("CARD_SETTLEMENT_PUBLIC")! : Keypair.random().publicKey();
  values.ATTESTER_EDDSA_PRIVKEY = generateAttesterKey();
  values.NULLIFIER_SECRET = generateNullifierSecret();
  values.PII_ENCRYPTION_KEY = hex32();
  values.SESSION_SECRET = randomBytes(32).toString("base64url");
  values.DEMO_SIGNER_SEED = hex32();

  // Plain settings: fill when missing (or when explicitly given).
  const settings: Record<string, string | undefined> = {
    DATABASE_URL: opts.databaseUrl,
    APP_URL: opts.appUrl,
    ADMIN_EMAILS: opts.adminEmails,
  };
  const merged = mergeEnvFile(text, values, { force: opts.force });
  let out = merged.text;
  const set = [...merged.set];
  const kept = [...merged.kept];
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    const r = mergeEnvFile(out, { [key]: value }, { force: true });
    out = r.text;
    set.push(key);
  }
  // A brand-new file from the template must not keep the placeholder admin.
  const admins = parseEnvFile(out).get("ADMIN_EMAILS");
  if (!opts.adminEmails && (!admins || admins === PLACEHOLDER_ADMIN)) {
    out = mergeEnvFile(out, { ADMIN_EMAILS: DEFAULT_ADMIN_EMAIL }, { force: true }).text;
    set.push("ADMIN_EMAILS");
  }
  writeFileSync(opts.envPath, out, { mode: 0o600 });

  const finalEnv = parseEnvFile(out);
  const accounts: Record<string, string> = {
    admin: Keypair.fromSecret(finalEnv.get("ADMIN_SECRET")!).publicKey(),
    operator: Keypair.fromSecret(finalEnv.get("OPERATOR_SECRET")!).publicKey(),
    treasury: Keypair.fromSecret(finalEnv.get("TREASURY_SECRET")!).publicKey(),
    sponsor: Keypair.fromSecret(finalEnv.get("SPONSOR_SECRET")!).publicKey(),
    cardSettlement: finalEnv.get("CARD_SETTLEMENT_PUBLIC")!,
  };
  const funded: string[] = [];
  if (opts.fund !== false) {
    for (const [role, address] of Object.entries(accounts)) {
      if (await ensureFunded(address, (m) => log(`${role}: ${m}`))) funded.push(role);
    }
  }
  return { set, kept, accounts, funded };
}
