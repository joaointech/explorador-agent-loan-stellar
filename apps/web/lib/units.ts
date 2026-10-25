// Units and protocol constants shared by the API, the UI and the scripts.
// On-chain amounts are i128 stroops of tEURC (7 decimals); off-chain and
// circuit amounts are EUR cents. stroops = cents × 100_000 (spec §5).

export const TOKEN_DECIMALS = 7;
export const STROOPS_PER_EUR = 10_000_000n;
export const STROOPS_PER_CENT = 100_000n;

/** Fixed-point scale used by the pool (borrow index, share price). */
export const SCALE = 10n ** 18n;
export const BPS = 10_000n;
export const YEAR_SECS = 31_536_000;
export const DAY_SECS = 86_400;

/** Protocol parameters (spec §5.1); the contract's `params()` is authoritative. */
export const PARAMS = {
  agentAprBps: 1200,
  protocolFeeBps: 1000,
  seniorTargetBps: 800,
  ltvBps: 5000,
  gracePeriodSecs: 180 * DAY_SECS,
  maxLeverage: 10,
} as const;

export const centsToStroops = (cents: bigint | number): bigint => BigInt(cents) * STROOPS_PER_CENT;

/** Rounds toward zero; callers that pay out should rely on the contract's rounding. */
export const stroopsToCents = (stroops: bigint | string): bigint => BigInt(stroops) / STROOPS_PER_CENT;

/** Display only: loses precision above ~€900M. */
export const stroopsToEur = (stroops: bigint | string): number => Number(BigInt(stroops)) / 1e7;

export const eurToCents = (eur: number): bigint => BigInt(Math.round(eur * 100));
export const eurToStroops = (eur: number): bigint => centsToStroops(eurToCents(eur));

/** Days since the Unix epoch, UTC (spec §8.4). */
export const unixToDay = (secs: number | bigint): number => Math.floor(Number(secs) / DAY_SECS);
export const dayToDate = (day: number): Date => new Date(day * DAY_SECS * 1000);
export const dateToDay = (d: Date): number => Math.floor(d.getTime() / 1000 / DAY_SECS);

/** Split rule (spec §1): agent gets floor(total / 2), explorador gets the rest. */
export function splitCommission(totalCents: bigint) {
  const agent = totalCents / 2n;
  return { agent, explorador: totalCents - agent };
}

/** Credit limit for a note: agent commission × LTV (spec §5.1). */
export const creditLimitCents = (agentCommissionCents: bigint): bigint =>
  (agentCommissionCents * BigInt(PARAMS.ltvBps)) / BPS;

/** total commission = floor(sale price × rate / 10_000) (spec §8.3). */
export const totalCommissionCents = (salePriceCents: bigint, rateBps: number): bigint =>
  (salePriceCents * BigInt(rateBps)) / BPS;
