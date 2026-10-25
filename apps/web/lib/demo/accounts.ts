// Testnet account helpers for the deploy / seed / e2e flows: Friendbot
// funding, XLM balances and top-ups. Testnet fees spike at times (DECISIONS.md
// "Deploy, seed and e2e"), so a role that runs low on XLM is topped up by
// funding a throwaway account with Friendbot (10,000 XLM) and merging it in.

import { Account, Asset, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { networkConfig } from "@/lib/stellar/config";
import { submitAndPoll } from "@/lib/stellar/invoke";
import { getRpc, rpcCall, sleep } from "@/lib/stellar/rpc";
import { asBigInt, scAddress } from "@/lib/stellar/scval";
import { simulateView } from "@/lib/stellar/simulate";

export const STROOPS_PER_XLM = 10_000_000n;
const FRIENDBOT_URL = "https://friendbot.stellar.org";
/** Classic inclusion fee (stroops); generous so surge pricing never stalls a merge. */
const CLASSIC_FEE = "100000";

export type Log = (message: string) => void;

export async function accountExists(address: string): Promise<boolean> {
  try {
    await getRpc().getAccount(address);
    return true;
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) return false;
    throw err;
  }
}

/** Creates `address` with Friendbot's 10,000 XLM (retries transient failures and rate limits). */
export async function friendbot(address: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let body = "";
    try {
      const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(address)}`);
      status = res.status;
      body = await res.text();
      if (res.ok) return;
      // Already funded (a retry after a lost response, or a concurrent run).
      if (/op_already_exists|createAccountAlreadyExist|already exists/i.test(body)) return;
    } catch (err) {
      body = err instanceof Error ? err.message : String(err);
    }
    if (attempt >= 4) throw new Error(`Friendbot could not fund ${address} (HTTP ${status}): ${body.slice(0, 300)}`);
    await sleep(2_000 * attempt);
  }
}

/** Funds `address` with Friendbot unless the account exists. Returns true when it was created now. */
export async function ensureFunded(address: string, log?: Log): Promise<boolean> {
  if (await accountExists(address)) return false;
  log?.(`funding ${address} with Friendbot`);
  await friendbot(address);
  for (let i = 0; i < 10 && !(await accountExists(address)); i++) await sleep(1_000);
  return true;
}

/** Native XLM balance in stroops (the native asset contract's `balance`); 0 for a missing account. */
export async function xlmBalance(address: string): Promise<bigint> {
  if (!(await accountExists(address))) return 0n;
  const sac = Asset.native().contractId(networkConfig().networkPassphrase);
  return asBigInt(await simulateView(sac, "balance", [scAddress(address)]), "balance");
}

/** Merges a fresh Friendbot-funded account into `target` (+~10,000 XLM). */
export async function mergeFreshAccount(target: string, log?: Log): Promise<string> {
  const temp = Keypair.random();
  await friendbot(temp.publicKey());
  const { networkPassphrase } = networkConfig();
  const account = await rpcCall("getAccount", () => getRpc().getAccount(temp.publicKey()));
  const tx = new TransactionBuilder(new Account(temp.publicKey(), account.sequenceNumber()), { fee: CLASSIC_FEE, networkPassphrase })
    .addOperation(Operation.accountMerge({ destination: target }))
    .setTimeout(60)
    .build();
  tx.sign(temp);
  const res = await submitAndPoll(tx, "account_merge");
  log?.(`topped up ${target} with a merged Friendbot account (tx ${res.txHash})`);
  return res.txHash;
}

/** Makes sure `address` exists and holds at least `minXlm` XLM, merging Friendbot accounts in as needed. */
export async function ensureXlm(address: string, minXlm: number, log?: Log): Promise<bigint> {
  await ensureFunded(address, log);
  const min = BigInt(Math.round(minXlm)) * STROOPS_PER_XLM;
  let balance = await xlmBalance(address);
  for (let i = 0; balance < min && i < 10; i++) {
    log?.(`${address} holds ${balance / STROOPS_PER_XLM} XLM (< ${minXlm}); topping up`);
    await mergeFreshAccount(address, log);
    balance = await xlmBalance(address);
  }
  if (balance < min) throw new Error(`Could not top up ${address} to ${minXlm} XLM`);
  return balance;
}

export const formatXlm = (stroops: bigint): string => `${(Number(stroops) / 1e7).toFixed(2)} XLM`;
