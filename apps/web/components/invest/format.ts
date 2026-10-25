// Display helpers specific to the investor dashboard (on top of lib/format).

import { EMPTY_VALUE, formatEur, formatMultiplier, formatPercent, formatToken } from "@/lib/format";

import { LEVERAGE_UNBOUNDED } from "./model";

/** eaSR shares: "4,987.1234 eaSR" (or just the number with `withSymbol: false`). */
export const formatShares = (shares: bigint | null | undefined, withSymbol = true): string =>
  shares === null || shares === undefined
    ? EMPTY_VALUE
    : formatToken(shares, { symbol: withSymbol ? "eaSR" : undefined, minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Token balance with two decimals: "10,000.00 tEURC", "9,999.98 XLM". */
export const formatBalance = (stroops: bigint | null | undefined, symbol: string): string =>
  stroops === null || stroops === undefined ? EMPTY_VALUE : formatToken(stroops, { symbol, minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A limit in euros, floored to the cent (what "Max" fills in), or "—" when unknown. */
export const formatEurLimit = (stroops: bigint | null | undefined): string =>
  stroops === null || stroops === undefined ? EMPTY_VALUE : formatEur(stroops > 0n ? stroops / 100_000n : 0n, { unit: "cents" });

/** Euros, or "—" when unknown. */
export const eurOrDash = (stroops: bigint | string | null | undefined, opts: Parameters<typeof formatEur>[1] = {}): string =>
  stroops === null || stroops === undefined || stroops === "" ? EMPTY_VALUE : formatEur(stroops, opts);

/** APY fraction as a percentage with two decimals: 0.0648 → "6.48%". */
export const apyText = (fraction: number | null | undefined): string => formatPercent(fraction, { decimals: 2 });

/** The pool's ×100 leverage ratio: "2.45×", or "∞" without first-loss capital. */
export const leverageText = (x100: number): string => (x100 >= LEVERAGE_UNBOUNDED ? "∞" : formatMultiplier(x100));
