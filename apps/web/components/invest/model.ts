// View model of the /invest dashboard (spec §10.2): what the presentational
// components render, independent of where the data comes from (live APIs and
// RPC in InvestDashboard, fixtures in the /invest/preview page and tests).

import type { DeploymentInfo, InvestorHistoryItem, InvestorResponse, PoolSnapshotsResponse, PoolStatsResponse } from "@/lib/types/api";
import { SCALE } from "@/lib/units";
import type { WalletErrorCode } from "@/lib/wallet/errors";
import type { LivePosition } from "@/lib/wallet/pool";
import type { TxPhase } from "@/lib/wallet/soroban";
import type { FreighterState } from "@/lib/wallet/use-freighter";

export type DeploymentState =
  | { status: "loading" }
  | { status: "ready"; deployment: DeploymentInfo }
  | { status: "not-deployed" }
  | { status: "error"; message: string };

/** A value fetched in the background; `data` survives refetches (no skeleton flash). */
export interface Remote<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
}

export const remote = <T>(data: T | undefined, opts: { error?: string | null; loading?: boolean } = {}): Remote<T> => ({
  data,
  error: opts.error ?? null,
  loading: opts.loading ?? false,
});

export type SnapshotRange = "7d" | "30d" | "all";
export const SNAPSHOT_RANGES: { value: SnapshotRange; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

export interface WalletView extends FreighterState {
  /** Passphrase the app runs on (from /api/config; testnet). */
  expectedPassphrase: string;
  /** Connected, but Freighter is on another network. */
  wrongNetwork: boolean;
}

export interface InvestModel {
  deployment: DeploymentState;
  wallet: WalletView;
  stats: Remote<PoolStatsResponse>;
  snapshots: Remote<PoolSnapshotsResponse>;
  range: SnapshotRange;
  /** GET /api/investor/[address]: deposits, withdrawals, earned. */
  investor: Remote<InvestorResponse>;
  /** Live contract reads for the connected address. */
  live: Remote<LivePosition>;
}

// ---------- actions ----------

export type ActionPhase = TxPhase | "fallback";
export type OnPhase = (phase: ActionPhase, info?: { txHash?: string }) => void;

export interface ActionResult {
  /** Human summary, e.g. "Deposited €5,000.00 for 4,987.1234 eaSR." */
  message: string;
  txHash: string | null;
}

export interface InvestActions {
  connect: () => void;
  disconnect: () => void;
  recheckWallet: () => void;
  retry: () => void;
  setRange: (range: SnapshotRange) => void;
  fundXlm: (onPhase: OnPhase) => Promise<ActionResult>;
  getTeurc: (onPhase: OnPhase) => Promise<ActionResult>;
  deposit: (assets: bigint, onPhase: OnPhase) => Promise<ActionResult>;
  withdraw: (assets: bigint, onPhase: OnPhase) => Promise<ActionResult>;
  /** Burns exact shares ("Max": a full exit without dust). */
  redeem: (shares: bigint, onPhase: OnPhase) => Promise<ActionResult>;
  /** Shares `deposit(assets)` would mint. */
  previewDeposit: (assets: bigint) => Promise<bigint>;
  /** Shares `withdraw(assets)` would burn. */
  previewWithdraw: (assets: bigint) => Promise<bigint>;
}

export type TxState =
  | { status: "idle" }
  | { status: "pending"; phase: ActionPhase; txHash?: string }
  | { status: "success"; message: string; txHash: string | null }
  | { status: "error"; message: string; txHash?: string; code?: WalletErrorCode };

// ---------- derived position ----------

export interface PositionView {
  shares: bigint | null;
  /** Current value of the shares, stroops. */
  value: bigint | null;
  deposited: bigint | null;
  withdrawn: bigint | null;
  /** value + withdrawn − deposited. */
  earned: bigint | null;
  /** Assets per share × 1e18. */
  sharePriceScaled: bigint | null;
  maxWithdraw: bigint | null;
  maxRedeem: bigint | null;
  /** Wallet tEURC, stroops. */
  teurc: bigint | null;
  /** XLM in stroops; null = account not funded yet; undefined = unknown. */
  xlm: bigint | null | undefined;
  history: InvestorHistoryItem[];
  /** Holds eaSR now. */
  hasShares: boolean;
  /** Never deposited (no shares, no history). */
  isEmpty: boolean;
}

const big = (s: string | undefined | null): bigint | null => (s === undefined || s === null || s === "" ? null : BigInt(s));

/**
 * Merges the investor API (history, deposited/withdrawn) with live contract
 * reads (shares, value, limits, balances). Live values win when both exist;
 * `earned` is recomputed from the live value so it moves with the share price.
 */
export function derivePosition(investor: InvestorResponse | undefined, live: LivePosition | undefined, stats: PoolStatsResponse | undefined): PositionView {
  const shares = live?.shares ?? big(investor?.shares);
  const value = live?.value ?? big(investor?.value);
  const deposited = big(investor?.deposited);
  const withdrawn = big(investor?.withdrawn);
  const earned =
    value !== null && deposited !== null && withdrawn !== null ? value + withdrawn - deposited : big(investor?.earned);
  let sharePriceScaled = big(stats?.stats.sharePriceScaled) ?? big(investor?.sharePriceScaled);
  if (sharePriceScaled === null && live && live.shares > 0n) sharePriceScaled = (live.value * SCALE) / live.shares;
  const history = investor?.history ?? [];
  const hasShares = (shares ?? 0n) > 0n;
  return {
    shares,
    value,
    deposited,
    withdrawn,
    earned,
    sharePriceScaled,
    maxWithdraw: live?.maxWithdraw ?? big(investor?.maxWithdraw),
    maxRedeem: live?.maxRedeem ?? null,
    teurc: live?.teurc ?? null,
    xlm: live ? live.xlm : undefined,
    history,
    hasShares,
    isEmpty: !hasShares && history.length === 0,
  };
}

/** Floors stroops to whole cents and renders them as an input value: 12_345_678_901n → "1234.56". */
export function stroopsToEurInput(stroops: bigint): string {
  const cents = stroops > 0n ? stroops / 100_000n : 0n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** The leverage ratio sentinel the pool returns when junior is 0 with debt outstanding (u32::MAX). */
export const LEVERAGE_UNBOUNDED = 4_294_967_295;

/** junior / (senior + junior) as a fraction; null when the pool is empty. */
export function coverage(seniorAssets: bigint, juniorAssets: bigint): number | null {
  const total = seniorAssets + juniorAssets;
  if (total <= 0n) return null;
  return Number((juniorAssets * 1_000_000n) / total) / 1_000_000;
}
