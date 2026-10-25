// Typed client-side helpers for the investor's contract calls (spec §7.1,
// §7.3): `advance_pool` SEP-56 vault reads and writes and `teurc.faucet`.
// Reads simulate (no signature); writes go through `invokeContract`, signed
// by the investor in Freighter.

import type { xdr } from "@stellar/stellar-sdk/base";

import type { DeploymentInfo } from "../types/api";
import { BPS, STROOPS_PER_CENT, YEAR_SECS } from "../units";
import { WalletError, contractError } from "./errors";
import {
  address,
  i128,
  invokeContract,
  loadAccount,
  simulateRead,
  toBigInt,
  type InvokeOutcome,
  type RpcLike,
  type SignTransaction,
  type TxPhase,
} from "./soroban";

export interface PoolClient {
  rpc: RpcLike;
  deployment: Pick<DeploymentInfo, "advancePool" | "teurc" | "networkPassphrase">;
}

export interface PoolSigner extends PoolClient {
  /** Investor's G… address: source, fee payer and every role (receiver / from / owner / operator). */
  source: string;
  sign: SignTransaction;
  onPhase?: (phase: TxPhase, info?: { txHash?: string }) => void;
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

type Target = "advancePool" | "teurc";

async function read(c: PoolClient, target: Target, method: string, args: xdr.ScVal[]): Promise<bigint> {
  const retval = await simulateRead(c.rpc, {
    networkPassphrase: c.deployment.networkPassphrase,
    contractId: c.deployment[target],
    method,
    args,
  });
  return toBigInt(retval, method);
}

// ---------- argument lists (SEP-56 order) ----------

/** `deposit(assets, receiver, from, operator)` */
export const depositArgs = (assets: bigint, receiver: string, from: string, operator: string): xdr.ScVal[] => [
  i128(assets),
  address(receiver),
  address(from),
  address(operator),
];

/** `withdraw(assets, receiver, owner, operator)` */
export const withdrawArgs = (assets: bigint, receiver: string, owner: string, operator: string): xdr.ScVal[] => [
  i128(assets),
  address(receiver),
  address(owner),
  address(operator),
];

/** `redeem(shares, receiver, owner, operator)` */
export const redeemArgs = (shares: bigint, receiver: string, owner: string, operator: string): xdr.ScVal[] => [
  i128(shares),
  address(receiver),
  address(owner),
  address(operator),
];

/** `teurc.faucet(to, amount)` */
export const faucetArgs = (to: string, amount: bigint): xdr.ScVal[] => [address(to), i128(amount)];

// ---------- views (simulation) ----------

/** eaSR shares held by `owner` (SEP-41 `balance`). */
export const readShareBalance = (c: PoolClient, owner: string) => read(c, "advancePool", "balance", [address(owner)]);
/** tEURC held by `owner`. */
export const readTeurcBalance = (c: PoolClient, owner: string) => read(c, "teurc", "balance", [address(owner)]);
/** Shares `deposit(assets)` would mint (rounded down). */
export const previewDeposit = (c: PoolClient, assets: bigint) => read(c, "advancePool", "preview_deposit", [i128(assets)]);
/** Shares `withdraw(assets)` would burn (rounded up). */
export const previewWithdraw = (c: PoolClient, assets: bigint) => read(c, "advancePool", "preview_withdraw", [i128(assets)]);
/** Assets `redeem(shares)` would pay (rounded down). */
export const previewRedeem = (c: PoolClient, shares: bigint) => read(c, "advancePool", "preview_redeem", [i128(shares)]);
/** `min(convert_to_assets(balance), lendable)`: what `owner` can withdraw right now. */
export const readMaxWithdraw = (c: PoolClient, owner: string) => read(c, "advancePool", "max_withdraw", [address(owner)]);
/** Shares `owner` can redeem right now (capped by lendable cash). */
export const readMaxRedeem = (c: PoolClient, owner: string) => read(c, "advancePool", "max_redeem", [address(owner)]);
/** Current value of `shares` in tEURC stroops (rounded down). */
export const convertToAssets = (c: PoolClient, shares: bigint) => read(c, "advancePool", "convert_to_assets", [i128(shares)]);

export interface LivePosition {
  /** eaSR shares. */
  shares: bigint;
  /** `convert_to_assets(shares)`, stroops. */
  value: bigint;
  maxWithdraw: bigint;
  maxRedeem: bigint;
  /** tEURC in the wallet, stroops. */
  teurc: bigint;
  /** XLM in stroops; null when the account doesn't exist yet (never funded). */
  xlm: bigint | null;
}

/** Everything the dashboard reads live for one investor, in two round trips. */
export async function readLivePosition(c: PoolClient, owner: string): Promise<LivePosition> {
  const [shares, maxWithdraw, maxRedeem, teurc, account] = await Promise.all([
    readShareBalance(c, owner),
    readMaxWithdraw(c, owner),
    readMaxRedeem(c, owner),
    readTeurcBalance(c, owner),
    loadAccount(c.rpc, owner),
  ]);
  const value = shares > 0n ? await convertToAssets(c, shares) : 0n;
  return { shares, value, maxWithdraw, maxRedeem, teurc, xlm: account?.xlm ?? null };
}

// ---------- writes (Freighter-signed) ----------

async function invoke(s: PoolSigner, target: Target, method: string, args: xdr.ScVal[]): Promise<InvokeOutcome> {
  return invokeContract({
    rpc: s.rpc,
    networkPassphrase: s.deployment.networkPassphrase,
    contractId: s.deployment[target],
    method,
    args,
    source: s.source,
    sign: s.sign,
    onPhase: s.onPhase,
    sleep: s.sleep,
    pollIntervalMs: s.pollIntervalMs,
    pollTimeoutMs: s.pollTimeoutMs,
  });
}

export interface VaultTxResult {
  txHash: string;
  ledger: number;
  /** Shares minted (deposit) or burned (withdraw / redeem). */
  shares: bigint;
  /** tEURC moved, stroops. */
  assets: bigint;
}

/** Deposits `assets` of the investor's tEURC; eaSR shares go to the investor. */
export async function deposit(s: PoolSigner, assets: bigint): Promise<VaultTxResult> {
  const out = await invoke(s, "advancePool", "deposit", depositArgs(assets, s.source, s.source, s.source));
  return { txHash: out.txHash, ledger: out.ledger, shares: toBigInt(out.returnValue, "deposit"), assets };
}

/** Withdraws exactly `assets` to the investor, burning their shares. */
export async function withdraw(s: PoolSigner, assets: bigint): Promise<VaultTxResult> {
  const out = await invoke(s, "advancePool", "withdraw", withdrawArgs(assets, s.source, s.source, s.source));
  return { txHash: out.txHash, ledger: out.ledger, shares: toBigInt(out.returnValue, "withdraw"), assets };
}

/** Burns exactly `shares` and pays their value to the investor ("Withdraw all" without dust). */
export async function redeem(s: PoolSigner, shares: bigint): Promise<VaultTxResult> {
  const out = await invoke(s, "advancePool", "redeem", redeemArgs(shares, s.source, s.source, s.source));
  return { txHash: out.txHash, ledger: out.ledger, shares, assets: toBigInt(out.returnValue, "redeem") };
}

/**
 * Slack for a withdrawal capped by the pool's liquidity: between our read and
 * the transaction executing (Freighter prompt included), accruing protocol
 * fees shrink `lendable` (pool cash − fees). Fees accrued over `secs` at the
 * current debt, plus a cent of rounding.
 */
export function liquiditySlack(totalDebt: bigint, params: { agentAprBps: number; protocolFeeBps: number }, secs = 600): bigint {
  const fees = (totalDebt * BigInt(params.agentAprBps) * BigInt(params.protocolFeeBps) * BigInt(secs)) / (BPS * BPS * BigInt(YEAR_SECS));
  return fees + 1n + STROOPS_PER_CENT;
}

/**
 * "Withdraw everything available", from a fresh read: when liquidity allows a
 * full exit, `redeem` every share (exact, no dust); when it doesn't,
 * `withdraw(max_withdraw − slack)`, since `max_redeem` has no headroom and
 * accrual between the read and execution would make it fail.
 */
export async function withdrawMax(s: PoolSigner, slack: bigint): Promise<VaultTxResult> {
  const [shares, maxRedeem, maxWithdraw] = await Promise.all([readShareBalance(s, s.source), readMaxRedeem(s, s.source), readMaxWithdraw(s, s.source)]);
  if (shares <= 0n) throw new WalletError("WALLET_ERROR", "You have no eaSR shares to withdraw.");
  if (maxRedeem >= shares) return redeem(s, shares);
  const assets = maxWithdraw - slack;
  if (assets <= 0n) throw contractError(5);
  return withdraw(s, assets);
}

/** `teurc.faucet(investor, amount)`: open to anyone on testnet, ≤ 25,000 tEURC per call. */
export async function faucet(s: PoolSigner, amount: bigint): Promise<{ txHash: string; ledger: number }> {
  const out = await invoke(s, "teurc", "faucet", faucetArgs(s.source, amount));
  return { txHash: out.txHash, ledger: out.ledger };
}
