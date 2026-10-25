// Small money helpers for the agent app (precise euro display for live interest).

export function toBig(s: string | null | undefined): bigint {
  if (!s) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

/** Stroops → "€12.345678" with `decimals` (≤ 7) fraction digits, en-GB grouping. */
export function formatStroopsPrecise(v: bigint, decimals = 6): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 10_000_000n;
  const frac = (a % 10_000_000n).toString().padStart(7, "0").slice(0, decimals);
  const w = Number(whole).toLocaleString("en-GB");
  return `${neg ? "−" : ""}€${w}${decimals > 0 ? "." + frac : ""}`;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** EUR string from an <input> → stroops (rounded to the cent). Returns null if invalid. */
export function parseEurInput(s: string): bigint | null {
  const t = s.replace(/[€\s,]/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w) * 10_000_000n + BigInt((f + "00").slice(0, 2)) * 100_000n;
}
