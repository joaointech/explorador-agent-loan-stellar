// The email sign-in flow through the real route handlers, with an in-memory
// database and cookie jar: start → code → verify → session → sign out.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
  process.env.ADMIN_EMAILS = "admin@explorador.ai";
  process.env.DEMO_MODE = "true";
  delete process.env.RESEND_API_KEY;
});

const state = vi.hoisted(() => ({
  jar: undefined as import("@/lib/auth/testing/fake-cookies").FakeCookieJar | undefined,
  sent: [] as { to: string; code: string }[],
}));

vi.mock("next/headers", async () => {
  const { createCookieJar } = await import("@/lib/auth/testing/fake-cookies");
  state.jar = createCookieJar();
  return { cookies: async () => state.jar };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: (await import("@/lib/auth/testing/fake-db")).fakeDb,
}));

vi.mock("@/lib/email/login-code", () => ({
  sendLoginCode: async (to: string, code: string) => {
    state.sent.push({ to, code });
    return { via: "console" as const };
  },
}));

import { POST as start } from "@/app/api/auth/email/start/route";
import { POST as verify } from "@/app/api/auth/email/verify/route";
import { DELETE as signOutRoute, GET as session } from "@/app/api/auth/session/route";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { fakeDb } from "@/lib/auth/testing/fake-db";
import type { EmailStartResponse, EmailVerifyResponse, SessionResponse } from "@/lib/types/api";

const post = (body: unknown, ip = "203.0.113.7") =>
  new Request("http://localhost:3104/api/auth/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function signInViaEmail(email: string, next?: string) {
  const startRes = await start(post({ email }));
  expect(startRes.status).toBe(200);
  const code = state.sent.at(-1)!.code;
  const verifyRes = await verify(post({ email, code, next }));
  expect(verifyRes.status).toBe(200);
  return json<EmailVerifyResponse>(verifyRes);
}

beforeEach(() => {
  fakeDb.reset();
  state.jar!.clear();
  state.sent.length = 0;
  resetRateLimits();
});

describe("POST /api/auth/email/start", () => {
  it("issues a code and reports how it was delivered", async () => {
    const res = await start(post({ email: "  Ana@Example.com " }));
    expect(res.status).toBe(200);
    const body = await json<EmailStartResponse>(res);
    expect(body).toMatchObject({ email: "ana@example.com", resendAfterSecs: 30, delivery: "console" });
    expect(body.demoCode).toBeUndefined();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    expect(state.sent).toEqual([{ to: "ana@example.com", code: expect.stringMatching(/^\d{6}$/) }]);
  });

  it("validates the body", async () => {
    const bad = await start(post({ email: "not-an-email" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect((await start(post("{"))).status).toBe(400);
  });

  it("rate-limits per email (cooldown) and per IP", async () => {
    await start(post({ email: "ana@example.com" }));
    const again = await start(post({ email: "ana@example.com" }));
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ error: { code: "RESEND_COOLDOWN" } });

    for (let i = 0; i < 18; i++) await start(post({ email: `user${i}@example.com` }));
    const flood = await start(post({ email: "late@example.com" }));
    expect(flood.status).toBe(429);
    expect(await flood.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect((await start(post({ email: "late@example.com" }, "198.51.100.9"))).status).toBe(200);
  });

  it("returns the code for seeded demo accounts in DEMO_MODE instead of emailing it", async () => {
    await fakeDb.user.create({ data: { email: "ana@demo.explorador.pt", role: "AGENT" } });
    const res = await start(post({ email: "ana@demo.explorador.pt" }));
    const body = await json<EmailStartResponse>(res);
    expect(body).toMatchObject({ delivery: "demo", demoCode: expect.stringMatching(/^\d{6}$/) });
    expect(state.sent).toHaveLength(0);

    const unknown = await start(post({ email: "zed@demo.explorador.pt" }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "DEMO_ACCOUNT_NOT_FOUND" } });
  });
});

describe("POST /api/auth/email/verify", () => {
  it("creates a new AGENT with a pre-passkey session and points it at /agent", async () => {
    const body = await signInViaEmail("ana@example.com");
    expect(body).toMatchObject({
      isNewUser: true,
      redirectTo: "/agent",
      user: { email: "ana@example.com", role: "AGENT", passkeyVerified: false },
    });
    const me = await json<SessionResponse>(await session());
    expect(me.user).toEqual(body.user);
  });

  it("gives ADMIN to emails in ADMIN_EMAILS and points them at /admin", async () => {
    const body = await signInViaEmail("Admin@Explorador.ai");
    expect(body).toMatchObject({ isNewUser: true, redirectTo: "/admin", user: { role: "ADMIN" } });
  });

  it("works as a fallback login for existing users and honours a safe next", async () => {
    const first = await signInViaEmail("ana@example.com");
    await signOutRoute();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
    try {
      const again = await signInViaEmail("ana@example.com", "/agent/settings");
      expect(again).toMatchObject({ isNewUser: false, redirectTo: "/agent/settings" });
      expect(again.user.userId).toBe(first.user.userId);
    } finally {
      vi.useRealTimers();
    }
    expect(fakeDb.user.rows).toHaveLength(1);
  });

  it("ignores a next the role can't open", async () => {
    const body = await signInViaEmail("ana@example.com", "/admin");
    expect(body.redirectTo).toBe("/agent");
  });

  it("rejects a wrong code without creating a user or a session", async () => {
    await start(post({ email: "ana@example.com" }));
    const code = state.sent[0]!.code;
    const wrongCode = code === "000000" ? "000001" : "000000";
    const res = await verify(post({ email: "ana@example.com", code: wrongCode }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_CODE" } });
    expect(fakeDb.user.rows).toHaveLength(0);
    expect((await json<SessionResponse>(await session())).user).toBeNull();
  });

  it("validates the code format", async () => {
    const res = await verify(post({ email: "ana@example.com", code: "12ab56" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("accepts a pasted code with spaces", async () => {
    await start(post({ email: "ana@example.com" }));
    const code = state.sent[0]!.code;
    const res = await verify(post({ email: "ana@example.com", code: `${code.slice(0, 3)} ${code.slice(3)}` }));
    expect(res.status).toBe(200);
  });
});

describe("/api/auth/session", () => {
  it("GET returns null when signed out; DELETE signs out", async () => {
    expect(await json<SessionResponse>(await session())).toEqual({ user: null });
    await signInViaEmail("ana@example.com");
    expect((await json<SessionResponse>(await session())).user).not.toBeNull();

    const res = await signOutRoute();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json<SessionResponse>(res)).toEqual({ user: null });
    expect((await json<SessionResponse>(await session())).user).toBeNull();
  });
});
