// Display formatting (§10.1): euros en-GB style, dates "14 Jan 2027", Europe/Lisbon.

export const STROOPS_PER_EUR = 10_000_000n;
export const YEAR_SECS = 31_536_000;
export const DAY_SECS = 86_400;

const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-GB");
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Lisbon" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Lisbon",
});
// Protocol days are UTC calendar days; format them in UTC so a day never shifts.
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Stroops (bigint | decimal string) → EUR number (for charts/maths, not money logic). */
export function stroopsToEur(s: bigint | string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  const v = typeof s === "bigint" ? s : BigInt(typeof s === "number" ? Math.trunc(s) : s);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / STROOPS_PER_EUR;
  const frac = Number(a % STROOPS_PER_EUR) / 1e7;
  const r = Number(whole) + frac;
  return neg ? -r : r;
}

export function eurToStroops(eurAmount: number): bigint {
  // round to the cent first so float noise never leaks into stroops
  const cents = Math.round(eurAmount * 100);
  return BigInt(cents) * 100_000n;
}

/** "€3,750.00". Rounds down to the cent (pool rounding: payouts round down). */
export function formatStroops(s: bigint | string | null | undefined, opts: { whole?: boolean } = {}): string {
  if (s === null || s === undefined) return "—";
  const v = typeof s === "bigint" ? s : BigInt(s);
  const cents = v >= 0n ? v / 100_000n : -((-v + 99_999n) / 100_000n);
  return formatEur(Number(cents) / 100, opts);
}

export function formatEur(amount: number, opts: { whole?: boolean } = {}): string {
  return (opts.whole ? eur0 : eur).format(amount);
}

export function formatCents(cents: number | bigint): string {
  return eur.format(Number(cents) / 100);
}

export function formatNumber(n: number): string {
  return num.format(n);
}

export function formatPct(fraction: number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatBps(bps: number, digits = 2): string {
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Real timestamps (ISO string, Date or unix seconds) → "14 Jan 2027" in Europe/Lisbon. */
export function formatDate(d: string | Date | number): string {
  const date = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return dateFmt.format(date);
}

export function formatDateTime(d: string | Date | number): string {
  const date = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return dateTimeFmt.format(date);
}

/** Protocol day number → "14 Jan 2027". */
export function formatDay(day: number): string {
  return dayFmt.format(new Date(day * DAY_SECS * 1000));
}

/** Protocol unix seconds → "14 Jan 2027" (UTC calendar, like protocol days). */
export function formatProtocolDate(secs: number): string {
  return dayFmt.format(new Date(secs * 1000));
}

export function protocolDay(secs: number): number {
  return Math.floor(secs / DAY_SECS);
}

/** "in 42 days" / "3 days ago" / "today". */
export function relativeDays(targetDay: number, todayDay: number): string {
  const d = targetDay - todayDay;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/** "CDLZ…4XQA" */
export function truncateAddress(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function truncateHex(hex: string, n = 8): string {
  return hex.length <= 2 * n + 1 ? hex : `${hex.slice(0, n)}…${hex.slice(-n)}`;
}

export function explorerUrl(kind: "tx" | "contract" | "account", id: string, network = "testnet"): string {
  return `https://stellar.expert/explorer/${network}/${kind}/${id}`;
}

/** Address explorer link for either G… accounts or C… contracts. */
export function addressExplorerUrl(addr: string, network = "testnet"): string {
  return explorerUrl(addr.startsWith("C") ? "contract" : "account", addr, network);
}

/**
 * Live interest ticking (client-side): the contract's debt grows at `aprBps` simple
 * interest between accruals, so debt(t) = debt0 × (1 + apr × Δt / YEAR).
 */
export function tickDebt(debtStroops: bigint, aprBps: number, elapsedSecs: number): bigint {
  if (elapsedSecs <= 0 || debtStroops <= 0n) return debtStroops;
  const num = debtStroops * BigInt(aprBps) * BigInt(Math.floor(elapsedSecs));
  return debtStroops + num / (10_000n * BigInt(YEAR_SECS));
}
