// Money and token formatting (spec §10.1): euros as `€3,750.00` (en-GB), all
// amounts exact. API amounts arrive as decimal strings of stroops (7 decimals);
// we stay in bigint until the final Intl call, which formats an exact decimal
// string, so large values never lose precision.
//
// No `@/` imports here: Vitest runs without a config, so this module only uses
// relative imports.

import { STROOPS_PER_CENT, TOKEN_DECIMALS } from "../units";

/** A bigint-safe amount: bigint, decimal integer string, or a JS number. */
export type AmountInput = bigint | string | number;
/** What the amount counts: tEURC stroops (default), EUR cents, or whole euros. */
export type AmountUnit = "stroops" | "cents" | "eur";
export type SignMode = "auto" | "always" | "exceptZero" | "never";

export interface FormatEurOptions {
  /** Unit of the input. Default `"stroops"`. */
  unit?: AmountUnit;
  /** Fraction digits shown: 2 (default) or 0 (rounded to whole euros). */
  decimals?: 0 | 2;
  /** Short form for stat tiles: `€65.4k`, `€1.3m`. Display only. */
  compact?: boolean;
  /** `always` / `exceptZero` add a `+` to positive amounts (activity feeds). */
  sign?: SignMode;
}

const STROOPS_PER_CENT_N = STROOPS_PER_CENT;
const LOCALE = "en-GB";

/** Integer division rounding half away from zero (bankers' rounding is not wanted for display). */
export function roundDiv(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("Division by zero");
  const q = n / d;
  const r = n % d;
  const twice = (r < 0n ? -r : r) * 2n;
  const dAbs = d < 0n ? -d : d;
  if (twice >= dAbs) return (n < 0n) !== (d < 0n) ? q - 1n : q + 1n;
  return q;
}

/** Parses an integer amount (stroops or cents) into a bigint. Throws on fractions or garbage. */
export function toBigIntAmount(value: AmountInput): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new RangeError(`Expected an integer amount, got ${value}`);
    }
    return BigInt(value);
  }
  const s = value.trim();
  if (!/^[-+]?\d+$/.test(s)) throw new RangeError(`Expected an integer amount string, got "${value}"`);
  return BigInt(s);
}

/**
 * Parses a euro amount typed by a person ("62", "62.5", "1,234.56", "€4.80") into
 * exact cents, rounding half away from zero past two decimals. Returns null when
 * the text is not a number.
 */
export function parseEurToCents(text: string): bigint | null {
  const s = text.replace(/[€\s,]/g, "");
  const m = /^([-+]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const negative = m[1] === "-";
  const whole = BigInt(m[2] || "0");
  const fracDigits = (m[3] ?? "").padEnd(3, "0");
  const cents = whole * 100n + BigInt(fracDigits.slice(0, 2)) + (Number(fracDigits[2]) >= 5 ? 1n : 0n);
  return negative ? -cents : cents;
}

/** Converts any supported amount into exact EUR cents (stroops round half away from zero). */
export function toCents(value: AmountInput, unit: AmountUnit = "stroops"): bigint {
  if (unit === "eur") {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new RangeError(`Expected a finite euro amount, got ${value}`);
      return BigInt(Math.round(value * 100));
    }
    if (typeof value === "bigint") return value * 100n;
    const cents = parseEurToCents(value);
    if (cents === null) throw new RangeError(`Expected a euro amount, got "${value}"`);
    return cents;
  }
  const n = toBigIntAmount(value);
  return unit === "cents" ? n : roundDiv(n, STROOPS_PER_CENT_N);
}

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let nf = formatters.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(LOCALE, options);
    formatters.set(key, nf);
  }
  return nf;
}

/** Exact decimal string for `units / 10^decimals`, e.g. (37500000000n, 7) → "3750.0000000". */
export function toDecimalString(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  if (decimals === 0) return `${neg ? "-" : ""}${abs}`;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

type NumericString = `${number}`;

/**
 * Formats a tEURC/EUR amount as `€3,750.00`.
 *
 *   formatEur("37500000000")            // "€3,750.00"  (stroops, the API default)
 *   formatEur(375000, { unit: "cents" }) // "€3,750.00"
 *   formatEur(4.8, { unit: "eur" })      // "€4.80"
 *   formatEur(x, { sign: "always" })     // "+€4,411.23"
 */
export function formatEur(value: AmountInput, options: FormatEurOptions = {}): string {
  const { unit = "stroops", decimals = 2, compact = false, sign = "auto" } = options;
  const cents = toCents(value, unit);
  const signDisplay = sign;

  if (compact) {
    const nf = numberFormat(`compact:${signDisplay}`, {
      style: "currency",
      currency: "EUR",
      notation: "compact",
      maximumFractionDigits: 1,
      signDisplay,
    });
    return nf.format(Number(cents) / 100);
  }

  const nf = numberFormat(`eur:${decimals}:${signDisplay}`, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay,
  });
  const exact = decimals === 0 ? toDecimalString(roundDiv(cents, 100n), 0) : toDecimalString(cents, 2);
  return nf.format(exact as NumericString);
}

/** `formatEur` for EUR cents (off-chain and circuit amounts). */
export const formatCents = (cents: AmountInput, options: Omit<FormatEurOptions, "unit"> = {}) =>
  formatEur(cents, { ...options, unit: "cents" });

export interface FormatTokenOptions {
  /** Token decimals. Default 7 (tEURC, eaSR). */
  decimals?: number;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Appended after a space, e.g. "eaSR". */
  symbol?: string;
}

/** Formats a token amount in base units, e.g. eaSR shares: `formatToken("12345678", { symbol: "eaSR" })` → "1.2346 eaSR". */
export function formatToken(value: AmountInput, options: FormatTokenOptions = {}): string {
  const { decimals = TOKEN_DECIMALS, minimumFractionDigits = 2, maximumFractionDigits = 4, symbol } = options;
  const nf = numberFormat(`token:${minimumFractionDigits}:${maximumFractionDigits}`, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
  const text = nf.format(toDecimalString(toBigIntAmount(value), decimals) as NumericString);
  return symbol ? `${text} ${symbol}` : text;
}

/** Share price from the pool's `sharePriceScaled` (assets per share × 1e18): `€1.0123`. */
export function formatSharePrice(scaled: AmountInput, fractionDigits = 4): string {
  const nf = numberFormat(`share:${fractionDigits}`, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return nf.format(toDecimalString(toBigIntAmount(scaled), 18) as NumericString);
}
