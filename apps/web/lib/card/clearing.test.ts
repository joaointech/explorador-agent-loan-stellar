import { beforeEach, describe, expect, it, vi } from "vitest";

const lithic = vi.hoisted(() => ({ enabled: true, simulateClearing: vi.fn() }));

vi.mock("@/lib/lithic/client", () => ({ lithicEnabled: () => lithic.enabled }));
vi.mock("@/lib/lithic/simulate", () => ({ simulateClearing: lithic.simulateClearing }));

import { clearLithicAuthorization } from "./clearing";

describe("clearLithicAuthorization", () => {
  beforeEach(() => {
    lithic.enabled = true;
    lithic.simulateClearing.mockReset().mockResolvedValue({ debugging_request_id: "req" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("clears a Lithic authorization once the draw has confirmed", async () => {
    expect(await clearLithicAuthorization("6f1d7c2a-1111-4222-8333-944455556666")).toBe("cleared");
    expect(lithic.simulateClearing).toHaveBeenCalledWith("6f1d7c2a-1111-4222-8333-944455556666");
  });

  it("skips purchases on the simulated card network", async () => {
    expect(await clearLithicAuthorization("sim_txn_abc")).toBe("skipped");
    expect(lithic.simulateClearing).not.toHaveBeenCalled();
  });

  it("skips everything when Lithic isn't configured", async () => {
    lithic.enabled = false;
    expect(await clearLithicAuthorization("6f1d7c2a-1111-4222-8333-944455556666")).toBe("skipped");
    expect(lithic.simulateClearing).not.toHaveBeenCalled();
  });

  it("reports a failed clearing without throwing", async () => {
    lithic.simulateClearing.mockRejectedValue(new Error("transaction already settled"));
    expect(await clearLithicAuthorization("6f1d7c2a-1111-4222-8333-944455556666")).toBe("failed");
  });
});
