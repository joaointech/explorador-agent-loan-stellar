import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_EMAILS = " Admin@Explorador.ai , ops@explorador.ai ";
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: (await import("@/lib/auth/testing/fake-db")).fakeDb,
}));

import { fakeDb } from "@/lib/auth/testing/fake-db";
import { findOrCreateUserByEmail, isDemoEmail, normalizeEmail, roleForEmail } from "@/lib/auth/users";

beforeEach(() => fakeDb.reset());

describe("roleForEmail", () => {
  it("gives ADMIN to addresses in ADMIN_EMAILS (trimmed, case-insensitive) and AGENT to everyone else", () => {
    expect(roleForEmail("admin@explorador.ai")).toBe("ADMIN");
    expect(roleForEmail("  ADMIN@explorador.AI ")).toBe("ADMIN");
    expect(roleForEmail("ops@explorador.ai")).toBe("ADMIN");
    expect(roleForEmail("ana@demo.explorador.pt")).toBe("AGENT");
    expect(roleForEmail("admin@explorador.ai.evil.com")).toBe("AGENT");
  });

  it("accepts an explicit admin list", () => {
    expect(roleForEmail("x@y.com", ["x@y.com"])).toBe("ADMIN");
    expect(roleForEmail("x@y.com", [])).toBe("AGENT");
  });
});

describe("findOrCreateUserByEmail", () => {
  it("creates new users with the role from ADMIN_EMAILS", async () => {
    const agent = await findOrCreateUserByEmail("Ana@Example.com");
    expect(agent).toMatchObject({ created: true, user: { email: "ana@example.com", role: "AGENT" } });

    const admin = await findOrCreateUserByEmail("admin@explorador.ai");
    expect(admin).toMatchObject({ created: true, user: { email: "admin@explorador.ai", role: "ADMIN" } });
  });

  it("returns the existing user on later sign-ins", async () => {
    const first = await findOrCreateUserByEmail("ana@example.com");
    const again = await findOrCreateUserByEmail("ana@example.com");
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(first.user.id);
    expect(fakeDb.user.rows).toHaveLength(1);
  });

  it("keeps the stored role in line with ADMIN_EMAILS", async () => {
    await fakeDb.user.create({ data: { email: "admin@explorador.ai", role: "AGENT" } });
    await fakeDb.user.create({ data: { email: "former@explorador.ai", role: "ADMIN" } });
    expect((await findOrCreateUserByEmail("admin@explorador.ai")).user.role).toBe("ADMIN");
    expect((await findOrCreateUserByEmail("former@explorador.ai")).user.role).toBe("AGENT");
  });

  it("recovers when a concurrent first sign-in created the row (P2002)", async () => {
    const existing = await fakeDb.user.create({ data: { email: "ana@example.com", role: "AGENT" } });
    const findUnique = vi.spyOn(fakeDb.user, "findUnique").mockResolvedValueOnce(null);
    const result = await findOrCreateUserByEmail("ana@example.com");
    expect(result).toMatchObject({ created: false, user: { id: existing.id } });
    findUnique.mockRestore();
  });
});

describe("email helpers", () => {
  it("normalizes and recognizes seed (demo) addresses", () => {
    expect(normalizeEmail("  Ana@Demo.Explorador.PT ")).toBe("ana@demo.explorador.pt");
    expect(isDemoEmail("ana@demo.explorador.pt")).toBe(true);
    expect(isDemoEmail("ANA@DEMO.EXPLORADOR.PT")).toBe(true);
    expect(isDemoEmail("ana@explorador.pt")).toBe(false);
    expect(isDemoEmail("ana@notdemo.explorador.pt")).toBe(false);
  });
});
