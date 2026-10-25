import { sealData } from "iron-session";
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
});

import { SESSION_COOKIE, type SessionData, sessionOptions } from "@/lib/auth/session-core";
import { config, proxy } from "@/proxy";

const BASE = "http://localhost:3104";

async function cookieFor(data: SessionData) {
  const { password, ttl } = sessionOptions();
  return sealData(data, { password, ttl });
}

async function run(path: string, session?: SessionData) {
  const headers = new Headers();
  if (session) headers.set("cookie", `${SESSION_COOKIE}=${await cookieFor(session)}`);
  const response = await proxy(new NextRequest(new URL(path, BASE), { headers }));
  return { response, redirect: getRedirectUrl(response) };
}

const agent: SessionData = { userId: "u1", email: "ana@example.com", role: "AGENT", passkeyVerified: true };
const admin: SessionData = { userId: "u2", email: "admin@example.com", role: "ADMIN", passkeyVerified: false, signedInAt: Date.now() };

describe("proxy matcher", () => {
  it.each(["/agent", "/agent/settings", "/admin", "/admin/cpcv/abc"])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each(["/", "/login", "/registry", "/invest", "/agents", "/api/agent/overview", "/api/auth/session"])(
    "skips %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});

describe("proxy", () => {
  it("sends signed-out visitors of /agent/** to /login with next", async () => {
    expect((await run("/agent")).redirect).toBe(`${BASE}/login?next=%2Fagent`);
    expect((await run("/agent/settings?tab=passkeys")).redirect).toBe(
      `${BASE}/login?next=%2Fagent%2Fsettings%3Ftab%3Dpasskeys`,
    );
  });

  it("sends signed-out visitors of /admin/** to /login with next", async () => {
    expect((await run("/admin/cpcv")).redirect).toBe(`${BASE}/login?next=%2Fadmin%2Fcpcv`);
  });

  it("lets agents into /agent and admins into /admin", async () => {
    const a = await run("/agent", agent);
    expect(a.redirect).toBeNull();
    expect(a.response.headers.get("x-middleware-next")).toBe("1");
    expect((await run("/admin/cpcv", admin)).redirect).toBeNull();
  });

  it("sends non-admins away from /admin and admins away from /agent", async () => {
    expect((await run("/admin", agent)).redirect).toBe(`${BASE}/agent`);
    expect((await run("/agent/settings", admin)).redirect).toBe(`${BASE}/admin`);
  });

  it("treats tampered cookies and stale pre-passkey sessions as signed out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const headers = new Headers({ cookie: `${SESSION_COOKIE}=Fe26.2*garbage` });
    const tampered = await proxy(new NextRequest(new URL("/agent", BASE), { headers }));
    expect(getRedirectUrl(tampered)).toBe(`${BASE}/login?next=%2Fagent`);

    const stale = { ...agent, passkeyVerified: false, signedInAt: Date.now() - 25 * 60 * 60 * 1000 };
    expect((await run("/agent", stale)).redirect).toBe(`${BASE}/login?next=%2Fagent`);
  });
});
