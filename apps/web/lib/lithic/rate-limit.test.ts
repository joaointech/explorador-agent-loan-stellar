import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/http";

import { createSpacer } from "./rate-limit";

describe("createSpacer (Lithic sandbox write spacing)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("starts calls at least intervalMs apart, without waiting for earlier calls to finish", async () => {
    const spaced = createSpacer(1_100);
    const starts: number[] = [];
    const slow = () => spaced(async () => {
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    });
    const calls = [slow(), slow(), slow()];
    await vi.advanceTimersByTimeAsync(2_200);
    expect(starts).toEqual([1_000_000, 1_001_100, 1_002_200]);
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all(calls);
  });

  it("does not delay calls that are already far enough apart", async () => {
    const spaced = createSpacer(1_100);
    await spaced(async () => undefined);
    await vi.advanceTimersByTimeAsync(2_000);
    const before = Date.now();
    await spaced(async () => undefined);
    expect(Date.now()).toBe(before);
  });

  it("refuses with 429 instead of queueing longer than maxWaitMs", async () => {
    const spaced = createSpacer(1_000, { maxWaitMs: 2_500 });
    const queued = [spaced(async () => 1), spaced(async () => 2), spaced(async () => 3)];
    await expect(spaced(async () => 4)).rejects.toBeInstanceOf(HttpError);
    await expect(spaced(async () => 4)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await Promise.all(queued)).toEqual([1, 2, 3]);
  });

  it("propagates the call's own errors", async () => {
    const spaced = createSpacer(10);
    await expect(spaced(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
