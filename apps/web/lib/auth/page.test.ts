import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
});

const state = vi.hoisted(() => ({ jar: undefined as import("@/lib/auth/testing/fake-cookies").FakeCookieJar | undefined }));

vi.mock("next/headers", async () => {
  const { createCookieJar } = await import("@/lib/auth/testing/fake-cookies");
  state.jar = createCookieJar();
  return { cookies: async () => state.jar };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: (await import("@/lib/auth/testing/fake-db")).fakeDb,
}));

import { requireAdminPage, requireAgentPage } from "@/lib/auth/page";
import { signIn } from "@/lib/auth/session";
import { fakeDb } from "@/lib/auth/testing/fake-db";

async function signInAs(email: string, role: "AGENT" | "ADMIN") {
  const user = (await fakeDb.user.create({ data: { email, role } })) as { id: string; email: string; role: typeof role };
  await signIn(user, { passkeyVerified: true });
  return user;
}

beforeEach(() => {
  fakeDb.reset();
  state.jar!.clear();
});

describe("page guards", () => {
  it("redirect signed-out visitors to /login with next", async () => {
    await expect(requireAgentPage("/agent/settings")).rejects.toThrow("REDIRECT /login?next=%2Fagent%2Fsettings");
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT /login?next=%2Fadmin");
  });

  it("return the user for the right role", async () => {
    const agent = await signInAs("ana@example.com", "AGENT");
    await expect(requireAgentPage()).resolves.toMatchObject({ userId: agent.id, role: "AGENT" });
  });

  it("send each role to its own home", async () => {
    await signInAs("ana@example.com", "AGENT");
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT /agent");
    state.jar!.clear();
    await signInAs("admin@example.com", "ADMIN");
    await expect(requireAgentPage()).rejects.toThrow("REDIRECT /admin");
    await expect(requireAdminPage()).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("treat a user deleted from the database as signed out (stale cookie)", async () => {
    await signInAs("ana@example.com", "AGENT");
    fakeDb.user.rows.length = 0;
    await expect(requireAgentPage()).rejects.toThrow("REDIRECT /login?next=%2Fagent");
  });
});
