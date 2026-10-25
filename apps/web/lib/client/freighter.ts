"use client";
// Freighter (investor wallet) helpers — @stellar/freighter-api v6.

import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import type { InvestorTxAction, InvestorTxPrepareRequest, TxPrepareResponse, TxSubmitResponse } from "@/lib/api-types";
import { apiPost } from "./api";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const STORAGE_KEY = "advance:freighter-connected";

export class FreighterError extends Error {
  constructor(
    message: string,
    public code: "NOT_INSTALLED" | "REJECTED" | "WRONG_NETWORK" | "UNKNOWN",
  ) {
    super(message);
    this.name = "FreighterError";
  }
}

function errText(e: unknown): string {
  if (!e) return "Unknown Freighter error";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message;
  return m ?? JSON.stringify(e);
}

export async function freighterInstalled(): Promise<boolean> {
  try {
    const r = await isConnected();
    return !!r.isConnected;
  } catch {
    return false;
  }
}

export interface FreighterNetwork {
  network: string;
  networkPassphrase: string;
  isTestnet: boolean;
}

export async function freighterNetwork(): Promise<FreighterNetwork> {
  const r = await getNetworkDetails();
  if (r.error) throw new FreighterError(errText(r.error), "UNKNOWN");
  return { network: r.network, networkPassphrase: r.networkPassphrase, isTestnet: r.networkPassphrase === TESTNET_PASSPHRASE };
}

/** Prompts the user to connect (first time) and returns the active address. */
export async function connectFreighter(): Promise<string> {
  if (!(await freighterInstalled())) {
    throw new FreighterError("Freighter is not installed. Get it at freighter.app, then reload this page.", "NOT_INSTALLED");
  }
  const r = await requestAccess();
  if (r.error || !r.address) throw new FreighterError(errText(r.error) || "Access was not granted", "REJECTED");
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
  return r.address;
}

/** Silently restores a previous connection (no prompt). */
export async function restoreFreighter(): Promise<string | null> {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== "1") return null;
    if (!(await freighterInstalled())) return null;
    const allowed = await isAllowed();
    if (!allowed.isAllowed) return null;
    const r = await getAddress();
    return r.address || null;
  } catch {
    return null;
  }
}

export function forgetFreighter() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function signWithFreighter(xdr: string, address: string, networkPassphrase = TESTNET_PASSPHRASE): Promise<string> {
  const net = await freighterNetwork();
  if (net.networkPassphrase !== networkPassphrase) {
    throw new FreighterError("Freighter is not on Testnet. Open Freighter → Settings → Network and switch to Testnet.", "WRONG_NETWORK");
  }
  const r = await signTransaction(xdr, { networkPassphrase, address });
  if (r.error || !r.signedTxXdr) throw new FreighterError(errText(r.error) || "Signature was rejected", "REJECTED");
  return r.signedTxXdr;
}

/** prepare (server builds the tx) → sign in Freighter → submit (server). */
export async function runInvestorTx(action: InvestorTxAction, address: string, amount?: string): Promise<TxSubmitResponse> {
  const req: InvestorTxPrepareRequest = { action, address, amount };
  const prepared = await apiPost<TxPrepareResponse>("/api/investor/tx/prepare", req);
  const signed = await signWithFreighter(prepared.xdr, address, prepared.networkPassphrase);
  const res = await apiPost<TxSubmitResponse>("/api/investor/tx/submit", { xdr: signed });
  if (res.status !== "SUCCESS") throw new Error(res.error ?? "Transaction failed");
  return res;
}

export async function friendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Friendbot answers 400 when the account is already funded.
    if (res.status === 400 && /already|createAccountAlreadyExist|op_already_exists/i.test(text)) return;
    throw new Error(`Friendbot failed (${res.status})`);
  }
}
