import { beforeEach, describe, expect, it } from "vitest";

import { clientIp, enforceRateLimit, formatWait, hit, resetRateLimits } from "@/lib/auth/rate-limit";
import { HttpError } from "@/lib/http";

beforeEach(() => resetRateLimits());

describe("hit", () => {
  it("allows up to the limit per window, then reports when to retry", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 60_000, t + i)).toEqual({ ok: true, retryAfterSecs: 0 });
    expect(hit("k", 3, 60_000, t + 10_000)).toEqual({ ok: false, retryAfterSecs: 50 });
    expect(hit("other", 3, 60_000, t + 10_000).ok).toBe(true);
    expect(hit("k", 3, 60_000, t + 60_000).ok).toBe(true); // new window
  });
});

describe("enforceRateLimit", () => {
  it("throws a 429 HttpError once over the limit", () => {
    enforceRateLimit("ip", 1, 60_000, "sign-in requests");
    let err: unknown;
    try {
      enforceRateLimit("ip", 1, 60_000, "sign-in requests");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect((err as Error).message).toMatch(/^Too many sign-in requests\. Try again in /);
  });
});

describe("helpers", () => {
  it("formats waits", () => {
    expect(formatWait(0)).toBe("1 s");
    expect(formatWait(25)).toBe("25 s");
    expect(formatWait(60)).toBe("1 minute");
    expect(formatWait(61)).toBe("2 minutes");
  });

  it("takes the client IP from the first x-forwarded-for hop", () => {
    const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
