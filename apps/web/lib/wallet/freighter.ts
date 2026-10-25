// Freighter (spec §2 "Investor wallet") wrappers over @stellar/freighter-api
// 6: detection, connection, network details, signing and change watching.
// Every Freighter error becomes a WalletError (errors.ts).

import {
  WatchWalletChanges,
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

import { TESTNET_PASSPHRASE } from "./constants";
import { WalletError, freighterError, toWalletError } from "./errors";
import type { SignTransaction } from "./soroban";

export interface FreighterNetwork {
  /** Freighter's network name, e.g. "TESTNET", "PUBLIC". */
  network: string;
  passphrase: string;
  /** The Soroban RPC Freighter is set to, if any (informational: the app uses its own). */
  rpcUrl?: string;
}

export interface FreighterSession {
  address: string;
  network: FreighterNetwork;
}

/** True when the Freighter extension answers (resolves false after ~2 s when it isn't installed). */
export async function detectFreighter(): Promise<boolean> {
  try {
    const res = await isConnected();
    return Boolean(res.isConnected) && !res.error;
  } catch {
    return false;
  }
}

/** Freighter's active network. */
export async function readFreighterNetwork(): Promise<FreighterNetwork> {
  const res = await getNetworkDetails();
  if (res.error) throw freighterError(res.error, "read its network");
  return { network: res.network, passphrase: res.networkPassphrase, rpcUrl: res.sorobanRpcUrl };
}

/** The session without any prompt, when this site is already allowed in Freighter; otherwise null. */
export async function restoreFreighterSession(): Promise<FreighterSession | null> {
  const allowed = await isAllowed().catch(() => ({ isAllowed: false }));
  if (!allowed.isAllowed) return null;
  const { address, error } = await getAddress();
  if (error || !address) return null;
  return { address, network: await readFreighterNetwork() };
}

/** Asks Freighter for access (opens its prompt) and returns the address and network. */
export async function connectFreighter(): Promise<FreighterSession> {
  let res: Awaited<ReturnType<typeof requestAccess>>;
  try {
    res = await requestAccess();
  } catch (err) {
    throw toWalletError(err, "Couldn't connect to Freighter.");
  }
  if (res.error) throw freighterError(res.error, "connect");
  if (!res.address) throw new WalletError("WALLET_ERROR", "Freighter didn't share an address. Unlock Freighter and try again.");
  return { address: res.address, network: await readFreighterNetwork() };
}

/** Signs with Freighter; the user approves in the extension popup. */
export const freighterSigner: SignTransaction = async (txXdr, { networkPassphrase, address }) => {
  let res: Awaited<ReturnType<typeof signTransaction>>;
  try {
    res = await signTransaction(txXdr, { networkPassphrase, address });
  } catch (err) {
    throw toWalletError(err, "Freighter couldn't sign the transaction.");
  }
  if (res.error) throw freighterError(res.error, "sign the transaction");
  if (!res.signedTxXdr) throw new WalletError("WALLET_ERROR", "Freighter returned no signature.");
  return res.signedTxXdr;
};

/**
 * Calls `onChange` when the account or network selected in Freighter
 * changes (polled every `intervalMs`), with null once Freighter stops sharing
 * an address (locked, or access revoked): two empty reports in a row, since
 * a single slow reply also comes back empty. Returns a stop function.
 */
export function watchFreighter(onChange: (session: FreighterSession | null) => void, intervalMs = 3_000): () => void {
  const watcher = new WatchWalletChanges(intervalMs);
  let empty = 0;
  watcher.watch(({ address, network, networkPassphrase, error }) => {
    if (error) return;
    if (!address) {
      empty += 1;
      if (empty >= 2) onChange(null);
      return;
    }
    empty = 0;
    onChange({ address, network: { network, passphrase: networkPassphrase } });
  });
  return () => watcher.stop();
}

const NETWORK_NAMES: Record<string, string> = {
  [TESTNET_PASSPHRASE]: "Testnet",
  "Public Global Stellar Network ; September 2015": "Mainnet",
  "Test SDF Future Network ; October 2022": "Futurenet",
  "Standalone Network ; February 2017": "Standalone",
};

/** "Testnet", "Mainnet", … for a network passphrase. */
export function networkName(network: Pick<FreighterNetwork, "network" | "passphrase"> | null | undefined): string {
  if (!network) return "unknown network";
  return NETWORK_NAMES[network.passphrase] ?? (network.network ? network.network.charAt(0) + network.network.slice(1).toLowerCase() : "a custom network");
}
