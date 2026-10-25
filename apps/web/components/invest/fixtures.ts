// Mocked data for /invest/preview and the view tests: a seeded-looking pool
// (two investors, five CPCV Notes, explorador's junior top-ups) and one
// investor's position. Amounts follow the API contract (decimal strings of
// stroops); live reads are bigints, as lib/wallet returns them.

import { projectedApy } from "@/lib/pool/apy";
import type { DeploymentInfo, InvestorResponse, PoolSnapshotPoint, PoolSnapshotsResponse, PoolStatsResponse } from "@/lib/types/api";
import { DAY_SECS, PARAMS, SCALE, STROOPS_PER_EUR } from "@/lib/units";
import { TESTNET_PASSPHRASE } from "@/lib/wallet/constants";
import type { LivePosition } from "@/lib/wallet/pool";

import type { SnapshotRange } from "./model";

/** €12.34 → stroops. */
const eur = (euros: number): bigint => BigInt(Math.round(euros * 100)) * (STROOPS_PER_EUR / 100n);
/** 4,987.1234 eaSR → base units (7 decimals). */
const shares = (amount: number): bigint => BigInt(Math.round(amount * 10_000)) * 1_000n;

/** Protocol "now" of the fixtures: 14 Jan 2027, 16:00 UTC (demo clock +81 days). */
export const FIXTURE_NOW = Date.UTC(2027, 0, 14, 16, 0) / 1000;

export const FIXTURE_INVESTOR = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

export const FIXTURE_DEPLOYMENT: DeploymentInfo = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: TESTNET_PASSPHRASE,
  teurc: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMA4OK",
  cpcvNote: "CC7RTXQJ4UZ2K6WQ3PMNVH5DLA2F6GYB7ZRK4XS3EOTUVW2NIQ7KD3MA",
  advancePool: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHG4XQA",
  explorerBase: "https://stellar.expert/explorer/testnet",
};

const SENIOR = eur(65_412.37);
const JUNIOR = eur(17_604.12);
const FEES = eur(41.18);
const DEBT = eur(9_868.4);
const PRINCIPAL = eur(9_702);
const SUPPLY = shares(64_903.2187);
const POOL_CASH = SENIOR + JUNIOR + FEES - DEBT;
const LENDABLE = POOL_CASH - FEES;

/** Assets per share × 1e18, the pool's formula: (senior + 1) × SCALE / (supply + 1). */
export const FIXTURE_SHARE_PRICE_SCALED = ((SENIOR + 1n) * SCALE) / (SUPPLY + 1n);

const PARAMS_JSON = {
  agentAprBps: PARAMS.agentAprBps,
  protocolFeeBps: PARAMS.protocolFeeBps,
  seniorTargetBps: PARAMS.seniorTargetBps,
  ltvBps: PARAMS.ltvBps,
  gracePeriodSecs: String(PARAMS.gracePeriodSecs),
  maxLeverage: PARAMS.maxLeverage,
  demoMode: true,
};

export function fixtureStats(): PoolStatsResponse {
  const apy = projectedApy({ totalDebt: DEBT, seniorAssets: SENIOR, juniorAssets: JUNIOR, params: PARAMS });
  return {
    stats: {
      seniorAssets: String(SENIOR),
      juniorAssets: String(JUNIOR),
      feesAccrued: String(FEES),
      totalDebt: String(DEBT),
      totalPrincipal: String(PRINCIPAL),
      poolCash: String(POOL_CASH),
      totalCardBalances: String(eur(4_611.23)),
      shareSupply: String(SUPPLY),
      sharePriceScaled: String(FIXTURE_SHARE_PRICE_SCALED),
      utilizationBps: Number((DEBT * 10_000n) / (DEBT + LENDABLE)),
      leverageX100: Number((DEBT * 100n) / JUNIOR),
      lendable: String(LENDABLE),
      leverageHeadroom: String(10n * JUNIOR - DEBT),
      borrowIndex: "1012345678901234567",
      protocolNow: String(FIXTURE_NOW),
      params: PARAMS_JSON,
      writtenOffTotal: "0",
    },
    apy: { target: 0.08, projectedSenior: apy.senior, projectedJunior: apy.junior, trailing7dSenior: 0.0171 },
    notes: { Active: 2, Settled: 2, Cancelled: 1, WrittenOff: 0, total: 5 },
    totalAdvanced: String(eur(14_950)),
    clock: { protocolNow: FIXTURE_NOW, offsetSecs: 81 * DAY_SECS, demoMode: true },
  };
}

/** A month of history: deposits early on, card draws and two settlements lifting the junior tranche. */
export function fixtureSnapshots(range: SnapshotRange = "7d"): PoolSnapshotsResponse {
  const days = range === "7d" ? 7 : 30;
  const startPrice = Number(FIXTURE_SHARE_PRICE_SCALED) / 1e18 / Math.pow(1 + 0.0171 / 365, 30);
  const points: PoolSnapshotPoint[] = [];
  for (let i = 30 - days; i <= 30; i++) {
    const t = FIXTURE_NOW - (30 - i) * DAY_SECS;
    const senior = i < 3 ? 40_000 + i * 8_000 : 65_000 + i * 13.7;
    const junior = 10_000 + (i >= 12 ? 7_500 : 0) + i * 3.5;
    const debt = 1_800 + i * 290 + Math.round(Math.sin(i / 3) * 450) - (i >= 12 ? 3_088.77 : 0) - (i >= 24 ? 1_150 : 0);
    const price = startPrice * Math.pow(1 + 0.0171 / 365, i) + Math.sin(i / 2.3) * 0.00004;
    points.push({
      t,
      sharePrice: Number(price.toFixed(9)),
      tvl: String(eur(senior + junior)),
      debt: String(eur(Math.max(0, debt))),
      seniorAssets: String(eur(senior)),
      juniorAssets: String(eur(junior)),
    });
  }
  return { range, points };
}

const SHARES = shares(4_987.1234);
const VALUE = (SHARES * (SENIOR + 1n)) / (SUPPLY + 1n);

export function fixtureInvestor(address = FIXTURE_INVESTOR): InvestorResponse {
  const deposited = eur(6_000);
  const withdrawn = eur(1_000);
  return {
    address,
    shares: String(SHARES),
    value: String(VALUE),
    deposited: String(deposited),
    withdrawn: String(withdrawn),
    earned: String(VALUE + withdrawn - deposited),
    sharePriceScaled: String(FIXTURE_SHARE_PRICE_SCALED),
    maxWithdraw: String(VALUE),
    history: [
      { type: "withdraw", assets: String(withdrawn), shares: String(shares(993.4417)), txHash: "5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", at: FIXTURE_NOW - 6 * DAY_SECS },
      { type: "deposit", assets: String(eur(1_000)), shares: String(shares(994.6612)), txHash: "a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3", at: FIXTURE_NOW - 19 * DAY_SECS },
      { type: "deposit", assets: String(eur(5_000)), shares: String(shares(4_985.9039)), txHash: "7b1e5f0a9c3d4e2f8a6b0c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7", at: FIXTURE_NOW - 28 * DAY_SECS },
    ],
  };
}

export function fixtureEmptyInvestor(address = FIXTURE_INVESTOR): InvestorResponse {
  return {
    address,
    shares: "0",
    value: "0",
    deposited: "0",
    withdrawn: "0",
    earned: "0",
    sharePriceScaled: String(FIXTURE_SHARE_PRICE_SCALED),
    maxWithdraw: "0",
    history: [],
  };
}

export function fixtureLive(opts: { empty?: boolean; unfunded?: boolean } = {}): LivePosition {
  if (opts.empty || opts.unfunded) {
    return { shares: 0n, value: 0n, maxWithdraw: 0n, maxRedeem: 0n, teurc: opts.unfunded ? 0n : eur(10_000), xlm: opts.unfunded ? null : eur(9_999.98) };
  }
  return { shares: SHARES, value: VALUE, maxWithdraw: VALUE, maxRedeem: SHARES, teurc: eur(5_000), xlm: eur(9_999.9562) };
}

/** Shares `deposit(assets)` / `withdraw(assets)` would mint / burn at the fixture share price (as the contract rounds). */
export const fixturePreviewDeposit = (assets: bigint): bigint => (assets * (SUPPLY + 1n)) / (SENIOR + 1n);
export const fixturePreviewWithdraw = (assets: bigint): bigint => (assets * (SUPPLY + 1n) + SENIOR) / (SENIOR + 1n);
