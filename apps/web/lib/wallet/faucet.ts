// Test funds for investors (spec §4.1 step 2): "Get test XLM" through
// Friendbot and "Get 10,000 tEURC" through a Freighter-signed
// `teurc.faucet`, falling back to POST /api/faucet/teurc when that fails.

import type { ApiError, TxResponse } from "../types/api";
import { FAUCET_AMOUNT, FAUCET_FALLBACK_ENDPOINT, FRIENDBOT_URL } from "./constants";
import { WalletError, toWalletError } from "./errors";
import { faucet, type PoolSigner } from "./pool";

export type FriendbotResult = { status: "funded"; txHash: string | null } | { status: "already-funded" };

/** Funds a new testnet account with test XLM. An account that already exists is not an error. */
export async function fundWithFriendbot(accountId: string, fetchImpl: typeof fetch = fetch): Promise<FriendbotResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(accountId)}`);
  } catch (err) {
    throw toWalletError(err, "Couldn't reach Friendbot.");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) {
    const hash = typeof body?.hash === "string" ? body.hash : typeof body?.id === "string" ? body.id : null;
    return { status: "funded", txHash: hash };
  }
  const detail = typeof body?.detail === "string" ? body.detail : "";
  // "account already funded to starting balance" (friendbot), op_already_exists / createAccountAlreadyExist (older).
  if (res.status === 400 && /already|exist/i.test(`${detail} ${JSON.stringify(body?.extras ?? "")}`)) {
    return { status: "already-funded" };
  }
  throw new WalletError("WALLET_ERROR", `Friendbot couldn't fund this account${detail ? `: ${detail}` : ` (HTTP ${res.status})`}.`);
}

/** POST /api/faucet/teurc { address }: the server mints 10,000 tEURC with the operator key. */
export async function serverFaucet(accountId: string, fetchImpl: typeof fetch = fetch): Promise<TxResponse> {
  let res: Response;
  try {
    res = await fetchImpl(FAUCET_FALLBACK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ address: accountId }),
    });
  } catch (err) {
    throw toWalletError(err, "Couldn't reach the server faucet.");
  }
  const body = (await res.json().catch(() => null)) as (Partial<TxResponse> & Partial<ApiError>) | null;
  if (res.ok && typeof body?.txHash === "string") {
    return { txHash: body.txHash, explorerUrl: typeof body.explorerUrl === "string" ? body.explorerUrl : "" };
  }
  const message = body?.error?.message ?? `HTTP ${res.status}`;
  throw new WalletError("WALLET_ERROR", `The server faucet couldn't send tEURC (${message}).`);
}

export interface TestEurcResult {
  via: "freighter" | "server";
  txHash: string;
  /** Why the Freighter path was skipped, when the server faucet was used. */
  fallbackReason?: string;
}

/**
 * "Get 10,000 tEURC": the investor signs `teurc.faucet` in Freighter; on any
 * failure except an explicit rejection in Freighter, the server faucet sends
 * the tokens instead (e.g. the account has no XLM for fees yet).
 */
export async function getTestEurc(opts: {
  signer: PoolSigner;
  amount?: bigint;
  fetchImpl?: typeof fetch;
  /** Called before falling back to the server faucet. */
  onFallback?: (reason: WalletError) => void;
}): Promise<TestEurcResult> {
  const amount = opts.amount ?? FAUCET_AMOUNT;
  try {
    const { txHash } = await faucet(opts.signer, amount);
    return { via: "freighter", txHash };
  } catch (err) {
    const reason = toWalletError(err);
    if (reason.code === "USER_DECLINED") throw reason;
    opts.onFallback?.(reason);
    try {
      const { txHash } = await serverFaucet(opts.signer.source, opts.fetchImpl);
      return { via: "server", txHash, fallbackReason: reason.message };
    } catch (fallbackErr) {
      const fallback = toWalletError(fallbackErr);
      throw new WalletError(fallback.code, `${reason.message} ${fallback.message}`, { cause: fallbackErr, txHash: reason.txHash });
    }
  }
}
