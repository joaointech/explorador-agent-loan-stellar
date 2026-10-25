// Fixed-window, in-memory rate limiter for the public auth endpoints.
//
// Per server instance (serverless runs several), so it blunts floods rather
// than enforcing a global cap. The limits that matter for account security
// (resend cooldown, codes per hour, attempts per code) live in Postgres; see
// lib/auth/email-code.ts.

import { HttpError } from "@/lib/http";

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSecs: number;
}

/** Records a hit for `key` and reports whether it's within `limit` hits per `windowMs`. */
export function hit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  let window = windows.get(key);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + windowMs };
    windows.set(key, window);
    if (windows.size > MAX_KEYS) prune(now);
  }
  if (window.count >= limit) return { ok: false, retryAfterSecs: Math.ceil((window.resetAt - now) / 1000) };
  window.count += 1;
  return { ok: true, retryAfterSecs: 0 };
}

function prune(now: number) {
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
}

export const tooManyRequests = (message: string, code = "RATE_LIMITED") => new HttpError(429, code, message);

/** Throws a 429 HttpError when `key` is over its limit. */
export function enforceRateLimit(key: string, limit: number, windowMs: number, what: string): void {
  const result = hit(key, limit, windowMs);
  if (!result.ok) {
    throw tooManyRequests(`Too many ${what}. Try again in ${formatWait(result.retryAfterSecs)}.`);
  }
}

export function formatWait(secs: number): string {
  if (secs < 60) return `${Math.max(1, secs)} s`;
  const mins = Math.ceil(secs / 60);
  return mins === 1 ? "1 minute" : `${mins} minutes`;
}

/** Best-effort client IP: the first `x-forwarded-for` hop (set by Vercel / the Next server), else `x-real-ip`. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}
