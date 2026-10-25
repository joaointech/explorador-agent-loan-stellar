import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
});

const state = vi.hoisted(() => ({ jar: undefined as import("@/lib/auth/testing/fake-cookies").FakeCookieJar | undefined }));

vi.mock("next/headers", async () => {
  const { createCookieJar } = await import("@/lib/auth/testing/fake-cookies");
  state.jar = createCookieJar();
  return { cookies: async () => state.jar };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: (await import("@/lib/auth/testing/fake-db")).fakeDb,
}));

import { sealData } from "iron-session";

import {
  PRE_PASSKEY_MAX_AGE_MS,
  readSessionCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECS,
  sessionUserFromData,
} from "@/lib/auth/session-core";
import {
  getSession,
  getSessionUser,
  requireAdmin,
  requireAgent,
  requireUser,
  signIn,
  signOut,
} from "@/lib/auth/session";
import { fakeDb } from "@/lib/auth/testing/fake-db";
import { HttpError } from "@/lib/http";

const jar = () => state.jar!;

async function createUser(email: string, role: "AGENT" | "ADMIN") {
  return (await fakeDb.user.create({ data: { email, role } })) as { id: string; email: string; role: "AGENT" | "ADMIN" };
}

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect(err).toMatchObject({ status, code });
}

beforeEach(() => {
  fakeDb.reset();
  jar().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session cookie", () => {
  it("is an httpOnly, lax, 7-day iron-session seal (secure only in production)", async () => {
    const agent = await createUser("ana@example.com", "AGENT");
    await signIn(agent, { passkeyVerified: false });

    const value = jar().values.get(SESSION_COOKIE);
    expect(value).toMatch(/^Fe26\.2\*/); // sealed and encrypted, not readable JSON
    expect(value).not.toContain("ana@example.com");
    expect(jar().lastOptions.get(SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false, // NODE_ENV is "test"
      maxAge: SESSION_TTL_SECS - 60,
    });
  });

  it("signIn stores the user and clears any WebAuthn challenge", async () => {
    const agent = await createUser("ana@example.com", "AGENT");
    const before = await getSession();
    before.challenge = "stale-challenge";
    await before.save();

    const user = await signIn(agent, { passkeyVerified: false });
    expect(user).toEqual({ userId: agent.id, email: agent.email, role: "AGENT", passkeyVerified: false });
    const session = await getSession();
    expect(session.challenge).toBeUndefined();
    expect(typeof session.signedInAt).toBe("number");
  });

  it("getSessionUser returns null when signed out and after signOut", async () => {
    expect(await getSessionUser()).toBeNull();
    const agent = await createUser("ana@example.com", "AGENT");
    await signIn(agent, { passkeyVerified: true });
    expect(await getSessionUser()).toMatchObject({ userId: agent.id, passkeyVerified: true });
    await signOut();
    expect(jar().values.has(SESSION_COOKIE)).toBe(false);
    expect(await getSessionUser()).toBeNull();
  });

  it("re-reads the user from the database: deleted users are signed out, role changes apply", async () => {
    const agent = await createUser("ana@example.com", "AGENT");
    await signIn(agent, { passkeyVerified: false });

    fakeDb.user.rows[0]!.role = "ADMIN";
    expect(await getSessionUser()).toMatchObject({ role: "ADMIN" });

    fakeDb.user.rows.length = 0;
    expect(await getSessionUser()).toBeNull();
  });

  it("treats a tampered or foreign cookie as signed out", async () => {
    const agent = await createUser("ana@example.com", "AGENT");
    await signIn(agent, { passkeyVerified: true });
    const sealed = jar().values.get(SESSION_COOKIE)!;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    jar().values.set(SESSION_COOKIE, sealed.slice(0, -4) + "AAAA");
    expect(await getSessionUser()).toBeNull();

    const foreign = await sealData({ userId: agent.id, email: agent.email, role: "ADMIN" }, { password: "x".repeat(32) });
    jar().values.set(SESSION_COOKIE, foreign);
    expect(await getSessionUser()).toBeNull();
  });

  it("limits pre-passkey (email-code) sessions to 24 h; passkey sessions last the full 7 days", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-01-14T10:00:00Z") });
    const ana = await createUser("ana@example.com", "AGENT");
    await signIn(ana, { passkeyVerified: false });
    const preCookie = jar().values.get(SESSION_COOKIE)!;
    await signIn(ana, { passkeyVerified: true });
    const passkeyCookie = jar().values.get(SESSION_COOKIE)!;

    vi.setSystemTime(Date.now() + PRE_PASSKEY_MAX_AGE_MS - 1000);
    jar().values.set(SESSION_COOKIE, preCookie);
    expect(await getSessionUser()).not.toBeNull();

    vi.setSystemTime(Date.now() + 2000);
    expect(await getSessionUser()).toBeNull();
    jar().values.set(SESSION_COOKIE, passkeyCookie);
    expect(await getSessionUser()).toMatchObject({ passkeyVerified: true });
  });
});

describe("guards", () => {
  it("requireUser: 401 when signed out", async () => {
    await expectHttpError(requireUser(), 401, "UNAUTHORIZED");
  });

  it("requireAgent: agents pass (pre-passkey too), admins get 403, signed-out 401", async () => {
    await expectHttpError(requireAgent(), 401, "UNAUTHORIZED");

    const agent = await createUser("ana@example.com", "AGENT");
    await signIn(agent, { passkeyVerified: false });
    await expect(requireAgent()).resolves.toMatchObject({ role: "AGENT", passkeyVerified: false });

    const admin = await createUser("admin@example.com", "ADMIN");
    await signIn(admin, { passkeyVerified: true });
    await expectHttpError(requireAgent(), 403, "FORBIDDEN");
  });

  it("requireAdmin: admins pass, agents get 403, signed-out 401", async () => {
    await expectHttpError(requireAdmin(), 401, "UNAUTHORIZED");

    const admin = await createUser("admin@example.com", "ADMIN");
    await signIn(admin, { passkeyVerified: false });
    await expect(requireAdmin()).resolves.toMatchObject({ role: "ADMIN" });

    const agent = await createUser("ana@example.com", "AGENT");
    await signIn(agent, { passkeyVerified: true });
    await expectHttpError(requireAdmin(), 403, "FORBIDDEN");
  });

  it("an agent demoted/promoted in the database is guarded by the new role", async () => {
    const user = await createUser("ana@example.com", "AGENT");
    await signIn(user, { passkeyVerified: true });
    fakeDb.user.rows[0]!.role = "ADMIN";
    await expectHttpError(requireAgent(), 403, "FORBIDDEN");
    await expect(requireAdmin()).resolves.toMatchObject({ userId: user.id });
  });
});

describe("session-core (shared with proxy.ts)", () => {
  it("readSessionCookie reads a real cookie without the database", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    await signIn(admin, { passkeyVerified: false });
    fakeDb.user.rows.length = 0; // proxy never looks at the database
    await expect(readSessionCookie(jar().values.get(SESSION_COOKIE))).resolves.toMatchObject({
      userId: admin.id,
      role: "ADMIN",
    });
    await expect(readSessionCookie(undefined)).resolves.toBeNull();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(readSessionCookie("garbage")).resolves.toBeNull();
  });

  it("sessionUserFromData rejects incomplete or malformed data", () => {
    const now = Date.now();
    const ok = { userId: "u1", email: "a@b.co", role: "AGENT" as const, passkeyVerified: true };
    expect(sessionUserFromData(ok, now)).toEqual(ok);
    expect(sessionUserFromData({}, now)).toBeNull();
    expect(sessionUserFromData({ ...ok, userId: "" }, now)).toBeNull();
    expect(sessionUserFromData({ ...ok, role: "ROOT" as never }, now)).toBeNull();
    expect(sessionUserFromData({ ...ok, passkeyVerified: undefined }, now)).toMatchObject({ passkeyVerified: false });
    expect(
      sessionUserFromData({ ...ok, passkeyVerified: false, signedInAt: now - PRE_PASSKEY_MAX_AGE_MS - 1 }, now),
    ).toBeNull();
  });
});
