// Percentages, basis points and plain numbers (en-GB grouping).

/** Shown wherever a value is unknown or not yet available. */
export const EMPTY_VALUE = "—";

const LOCALE = "en-GB";
const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options);
    cache.set(key, f);
  }
  return f;
}

export interface PercentOptions {
  /** Fixed fraction digits. Default 2 ("6.48%"). */
  decimals?: number;
  /** Add "+" to positive values (deltas). */
  signed?: boolean;
}

/** A fraction as a percentage: `formatPercent(0.0648)` → "6.48%". null/undefined/NaN → "—". */
export function formatPercent(fraction: number | null | undefined, options: PercentOptions = {}): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return EMPTY_VALUE;
  const { decimals = 2, signed = false } = options;
  return nf(`pct:${decimals}:${signed}`, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(fraction);
}

/** Basis points as a percentage with trailing zeros trimmed: 1200 → "12%", 1250 → "12.5%", 875 → "8.75%". */
export function formatBps(bps: number | bigint, options: { maxDecimals?: number } = {}): string {
  const { maxDecimals = 2 } = options;
  return nf(`bps:${maxDecimals}`, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(Number(bps) / 10_000);
}

/** Grouped number: 375420 → "375,420". Accepts bigint for exact large counts. */
export function formatNumber(value: number | bigint, options: Intl.NumberFormatOptions = {}): string {
  return nf(`num:${JSON.stringify(options)}`, options).format(value);
}

/** A ×100 fixed-point ratio (the pool's `leverageX100`) as a multiplier: 245 → "2.45×". */
export function formatMultiplier(x100: number, decimals = 2): string {
  return `${nf(`mul:${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(x100 / 100)}×`;
}
