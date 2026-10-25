import { describe, expect, it, vi } from "vitest";

import { ContractError, RpcError, RpcTimeoutError } from "./errors";
import { isTransientNetworkError, retryTransient, rpcCall, rpcErrorInfo, withTimeout } from "./rpc";

/** What undici throws when a pooled keep-alive socket was closed by the server. */
const staleSocket = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
const rangeError = () => Object.assign(new Error("startLedger must be within the ledger range: 5262676 - 5383635"), { code: -32600 });

describe("rpcErrorInfo", () => {
  it("includes undici's cause", () => {
    expect(rpcErrorInfo(staleSocket()).message).toBe("fetch failed: other side closed (UND_ERR_SOCKET)");
    expect(rpcErrorInfo(rangeError())).toEqual({ message: "startLedger must be within the ledger range: 5262676 - 5383635", code: -32600 });
  });
});

describe("retryTransient", () => {
  it("retries network blips and then succeeds", async () => {
    const call = vi.fn().mockRejectedValueOnce(staleSocket()).mockRejectedValueOnce(staleSocket()).mockResolvedValue("ok");
    await expect(retryTransient(call)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retries", async () => {
    const call = vi.fn().mockRejectedValue(staleSocket());
    await expect(retryTransient(call, 1)).rejects.toThrow("fetch failed");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("never retries JSON-RPC or contract errors", async () => {
    for (const err of [rangeError(), new ContractError(12, "card_draw")]) {
      const call = vi.fn().mockRejectedValue(err);
      await expect(retryTransient(call)).rejects.toBe(err);
      expect(call).toHaveBeenCalledTimes(1);
      expect(isTransientNetworkError(err)).toBe(false);
    }
  });
});

describe("rpcCall / withTimeout", () => {
  it("wraps transport failures as 502 RPC_UNAVAILABLE with the cause", async () => {
    const err = await rpcCall("getHealth", () => Promise.reject(rangeError())).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err).toMatchObject({ status: 502, code: "RPC_UNAVAILABLE" });
    expect(err.message).toContain("getHealth failed: startLedger must be within");
  });

  it("enforces the timeout budget (ASA reads use 1.2 s)", async () => {
    const err = await withTimeout(new Promise(() => {}), 20, "advancePool.stats").catch((e) => e);
    expect(err).toBeInstanceOf(RpcTimeoutError);
    expect(err).toMatchObject({ status: 504, code: "RPC_TIMEOUT" });
  });
});
