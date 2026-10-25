// Lithic sandbox write limits (docs: Rate Limits): 1 request/s per resource
// (simulations included), 2/s for cards. A spacer hands out start slots at
// least `intervalMs` apart; calls may overlap once started. Process-local: the
// SDK's 429 retry (it honours `retry-after`) covers other instances.

import { HttpError } from "@/lib/http";

export interface Spacer {
  <T>(fn: () => Promise<T>): Promise<T>;
}

export function createSpacer(intervalMs: number, opts: { maxWaitMs?: number } = {}): Spacer {
  let nextSlot = 0;
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const start = Math.max(now, nextSlot);
    if (opts.maxWaitMs !== undefined && start - now > opts.maxWaitMs) {
      throw new HttpError(429, "RATE_LIMITED", "Lithic sandbox allows about one simulated purchase per second; try again in a moment");
    }
    nextSlot = start + intervalMs;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
    return fn();
  };
}
