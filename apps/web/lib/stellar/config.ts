// Network settings and role keys from the environment (spec §3, §11.3).
// Shared with scripts, so no `server-only` import.

import { Keypair } from "@stellar/stellar-sdk";

import { env } from "@/lib/env";

import { NotConfiguredError } from "./errors";
import { EXPLORER_BASE } from "./explorer";

export interface NetworkConfig {
  network: "testnet";
  rpcUrl: string;
  networkPassphrase: string;
  explorerBase: string;
}

export function networkConfig(): NetworkConfig {
  const e = env();
  return {
    network: e.STELLAR_NETWORK,
    rpcUrl: e.STELLAR_RPC_URL,
    networkPassphrase: e.STELLAR_NETWORK_PASSPHRASE,
    explorerBase: EXPLORER_BASE,
  };
}

export type RoleSecret = "OPERATOR_SECRET" | "TREASURY_SECRET" | "ADMIN_SECRET" | "SPONSOR_SECRET";

/** Keypair for a role secret; throws a 503 NOT_CONFIGURED HttpError when it is missing or invalid. */
export function roleKeypair(key: RoleSecret): Keypair {
  const secret = env()[key];
  if (!secret) throw new NotConfiguredError(`${key} is not set (run pnpm keys:generate)`);
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new NotConfiguredError(`${key} is not a valid Stellar secret key`);
  }
}

export const operatorKeypair = () => roleKeypair("OPERATOR_SECRET");
export const treasuryKeypair = () => roleKeypair("TREASURY_SECRET");
export const adminKeypair = () => roleKeypair("ADMIN_SECRET");
