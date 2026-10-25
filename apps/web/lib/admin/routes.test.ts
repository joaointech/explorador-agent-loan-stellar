// Every admin route is admin-only (spec §3, §9.7), enforced with the real
// session guard (iron-session cookie re-checked against the database; here an
// in-memory database and cookie jar). Also: JSON-only mutations, and the demo
// routes refuse to run when DEMO_MODE is off. No Postgres needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
  process.env.DEMO_MODE = "false";
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

import { POST as writeOff } from "@/app/api/admin/agents/[id]/write-off/route";
import { GET as agents } from "@/app/api/admin/agents/route";
import { POST as cancel } from "@/app/api/admin/cpcv/[id]/cancel/route";
import { GET as detail } from "@/app/api/admin/cpcv/[id]/route";
import { POST as settle } from "@/app/api/admin/cpcv/[id]/settle/route";
import { GET as listCpcvs, POST as createCpcv } from "@/app/api/admin/cpcv/route";
import { POST as advanceClock } from "@/app/api/admin/demo/advance-clock/route";
import { POST as reset } from "@/app/api/admin/demo/reset/route";
import { POST as claimFees } from "@/app/api/admin/fees/claim/route";
import { POST as juniorDeposit } from "@/app/api/admin/junior/deposit/route";
import { POST as juniorWithdraw } from "@/app/api/admin/junior/withdraw/route";
import { GET as overview } from "@/app/api/admin/overview/route";
import { signIn } from "@/lib/auth/session";
import { fakeDb } from "@/lib/auth/testing/fake-db";

const json = (body: unknown = {}, contentType = "application/json") => ({
  method: "POST",
  headers: { "content-type": contentType },
  body: JSON.stringify(body),
});
const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const ctx = { params: Promise.resolve({ id: "some-id" }) };

const ROUTES: [string, () => Promise<Response>][] = [
  ["GET /api/admin/cpcv", () => listCpcvs()],
  ["POST /api/admin/cpcv", () => createCpcv(req("/api/admin/cpcv", json({})))],
  ["GET /api/admin/cpcv/[id]", () => detail(req("/api/admin/cpcv/some-id"), ctx)],
  ["POST /api/admin/cpcv/[id]/settle", () => settle(req("/api/admin/cpcv/some-id/settle", json()), ctx)],
  ["POST /api/admin/cpcv/[id]/cancel", () => cancel(req("/api/admin/cpcv/some-id/cancel", json()), ctx)],
  ["GET /api/admin/agents", () => agents()],
  ["POST /api/admin/agents/[id]/write-off", () => writeOff(req("/api/admin/agents/some-id/write-off", json()), ctx)],
  ["POST /api/admin/junior/deposit", () => juniorDeposit(req("/api/admin/junior/deposit", json({ amountEur: 1 })))],
  ["POST /api/admin/junior/withdraw", () => juniorWithdraw(req("/api/admin/junior/withdraw", json({ amountEur: 1 })))],
  ["POST /api/admin/fees/claim", () => claimFees(req("/api/admin/fees/claim", json({ amountEur: 1 })))],
  ["POST /api/admin/demo/advance-clock", () => advanceClock(req("/api/admin/demo/advance-clock", json({ days: 1 })))],
  ["POST /api/admin/demo/reset", () => reset(req("/api/admin/demo/reset", json()))],
  ["GET /api/admin/overview", () => overview()],
];

async function signInAs(role: "AGENT" | "ADMIN") {
  const user = (await fakeDb.user.create({ data: { email: `${role.toLowerCase()}@example.com`, role } })) as { id: string; email: string; role: typeof role };
  await signIn(user, { passkeyVerified: true });
}

beforeEach(() => {
  fakeDb.reset();
  state.jar!.clear();
});

describe("admin API auth guard", () => {
  it.each(ROUTES)("%s → 401 when signed out", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
  });

  it.each(ROUTES)("%s → 403 for agents", async (_name, call) => {
    await signInAs("AGENT");
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "FORBIDDEN", message: "This is only available to admins" } });
  });

  it("lets admins through, but only with JSON bodies on mutations", async () => {
    await signInAs("ADMIN");
    const plain = await juniorDeposit(req("/api/admin/junior/deposit", json({ amountEur: 1 }, "text/plain")));
    expect(plain.status).toBe(415);
    const badBody = await createCpcv(req("/api/admin/cpcv", json({ agentId: "x" })));
    expect(badBody.status).toBe(400);
    expect((await badBody.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses the demo clock and reset when DEMO_MODE is off", async () => {
    await signInAs("ADMIN");
    const clock = await advanceClock(req("/api/admin/demo/advance-clock", json({ days: 7 })));
    expect(clock.status).toBe(409);
    expect(await clock.json()).toEqual({ error: { code: "DEMO_MODE_DISABLED", message: "The demo clock can only be moved when DEMO_MODE=true" } });
    const resetRes = await reset(req("/api/admin/demo/reset", json()));
    expect(resetRes.status).toBe(409);
    expect((await resetRes.json()).error.code).toBe("DEMO_MODE_DISABLED");
  });
});
