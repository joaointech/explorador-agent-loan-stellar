// Interface owned by the Smart accounts workstream (spec §2 Agent wallet,
// §4.2, §9.3): OpenZeppelin smart accounts for agents, fees paid by the
// sponsor. The implementation replaces the stub bodies.

import { notImplemented } from "@/lib/http";

const OWNER = "smart accounts";

export interface DeployedAccount {
  /** C… contract address of the smart account. */
  address: string;
  txHash: string | null;
}

/** Deploys the agent's smart account whose signer is the passkey's P-256 public key (sponsored). */
export async function deployPasskeySmartAccount(_input: {
  credentialId: string;
  /** 65-byte uncompressed secp256r1 public key. */
  publicKeyP256: Uint8Array;
}): Promise<DeployedAccount> {
  notImplemented("deployPasskeySmartAccount", OWNER);
}

/** Seed agents (spec §11.2): smart account controlled by a server-held Ed25519 demo signer. */
export async function deployDemoSmartAccount(_input: {
  /** Stable label (e.g. the agent's email) the demo signer is derived from. */
  label: string;
}): Promise<DeployedAccount> {
  notImplemented("deployDemoSmartAccount", OWNER);
}
