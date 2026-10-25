// POST /api/lithic/asa while LITHIC_ASA_HMAC_SECRET is unset: production
// refuses unsigned requests before any card state is read; other
// environments (tests, a local tunnel before `pnpm lithic:enroll`) serve them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.LITHIC_ASA_HMAC_SECRET;
});

const pipeline = vi.hoisted(() => ({ processAsaRequest: vi.fn() }));
vi.mock("@/lib/card/asa", () => pipeline);
vi.mock("next/server", () => ({ after: vi.fn() }));

import { POST } from "./route";

const unsigned = () =>
  new Request("http://localhost/api/lithic/asa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "txn-1", status: "AUTHORIZATION", amount: 480, card: { token: "card-1" } }),
  });

beforeEach(() => {
  pipeline.processAsaRequest.mockReset().mockResolvedValue({
    response: { result: "APPROVED", token: "txn-1" },
    authorizationId: "auth-1",
    decision: "APPROVED",
    declineReason: null,
    followUp: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/lithic/asa without an ASA secret", () => {
  it("refuses unsigned requests in production, before any card state is read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(unsigned());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "ASA_NOT_CONFIGURED" } });
    expect(pipeline.processAsaRequest).not.toHaveBeenCalled();
  });

  it("serves unsigned requests outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await POST(unsigned());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "APPROVED", token: "txn-1" });
    expect(pipeline.processAsaRequest).toHaveBeenCalledTimes(1);
  });
});
