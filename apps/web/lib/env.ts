import { z } from "zod";

// Typed access to environment variables. Parsed lazily so `next build` and
// scripts that don't need every key still work; call `requireEnv` for keys
// that must be present at the point of use.

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: optional,
  APP_URL: z.string().default("http://localhost:3000"),
  SESSION_SECRET: optional,
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default("explorador advance <advance@explorador.ai>"),
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  WEBAUTHN_RP_NAME: z.string().default("explorador advance"),

  STELLAR_NETWORK: z.literal("testnet").default("testnet"),
  STELLAR_RPC_URL: z.string().default("https://soroban-testnet.stellar.org"),
  STELLAR_NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  ADMIN_SECRET: optional,
  OPERATOR_SECRET: optional,
  TREASURY_SECRET: optional,
  CARD_SETTLEMENT_PUBLIC: optional,
  SPONSOR_SECRET: optional,
  // Smart accounts (agent passkey wallet). The contract ids default to the
  // smart-account-kit testnet deployment (see lib/stellar/smart-account.ts).
  DEMO_SIGNER_SEED: optional,
  SMART_ACCOUNT_WASM_HASH: optional,
  WEBAUTHN_VERIFIER_ID: optional,
  ED25519_VERIFIER_ID: optional,
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === undefined || v.trim() === "" || v.trim() === "true"),
  /**
   * Opt-in (off unless exactly "true"): in DEMO_MODE, also return the sign-in
   * code of seeded demo-domain accounts that are in ADMIN_EMAILS. Anyone who
   * can open the site can then sign in as that admin.
   */
  DEMO_ADMIN_SIGNIN: z
    .string()
    .optional()
    .transform((v) => v?.trim() === "true"),

  ATTESTER_EDDSA_PRIVKEY: optional,
  NULLIFIER_SECRET: optional,
  PII_ENCRYPTION_KEY: optional,

  LITHIC_API_KEY: optional,
  LITHIC_ASA_HMAC_SECRET: optional,
  /** Bearer token accepted by /api/cron/* (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
  CRON_SECRET: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

/** Test hook: re-read process.env on the next `env()` call. */
export function resetEnvCache(): void {
  cached = undefined;
}

type OptionalKey = {
  [K in keyof Env]: undefined extends Env[K] ? K : never;
}[keyof Env];

/** Returns the value of an optional env var, or throws a clear error if it is missing. */
export function requireEnv<K extends OptionalKey>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null) {
    throw new Error(`Missing environment variable ${key} (see apps/web/.env.example)`);
  }
  return value as NonNullable<Env[K]>;
}

export const isAdminEmail = (email: string) => env().ADMIN_EMAILS.includes(email.trim().toLowerCase());
