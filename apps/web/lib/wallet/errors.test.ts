import { describe, expect, it } from "vitest";

import { WalletError, describeContractError, freighterError, parseSimulationError, resultCodeMessage, toWalletError } from "./errors";

describe("parseSimulationError", () => {
  it("reads the contract error code", () => {
    const err = parseSimulationError("HostError: Error(Contract, #3)\n\nEvent log (newest first):\n 0: [Diagnostic Event] …");
    expect(err).toMatchObject({ code: "CONTRACT_ERROR", contractCode: 3 });
    expect(err.message).toBe(describeContractError(3).message);
  });

  it("names unknown contract errors by number", () => {
    expect(parseSimulationError("HostError: Error(Contract, #77)").message).toMatch(/#77/);
  });

  it("detects missing contracts and other host errors", () => {
    expect(parseSimulationError("HostError: Error(Storage, MissingValue)\n… contract code …").code).toBe("CONTRACT_MISSING");
    const budget = parseSimulationError("HostError: Error(Budget, ExceededLimit)\n…");
    expect(budget.code).toBe("SIMULATION_FAILED");
    expect(budget.message).toMatch(/Error\(Budget, ExceededLimit\)/);
  });
});

describe("freighterError", () => {
  it("maps code −4 to a user rejection", () => {
    expect(freighterError({ code: -4, message: "The user rejected this request." }, "sign").code).toBe("USER_DECLINED");
  });

  it("keeps other Freighter messages", () => {
    const err = freighterError({ code: -1, message: "The wallet encountered an internal error." }, "sign the transaction");
    expect(err.code).toBe("WALLET_ERROR");
    expect(err.message).toBe("Freighter couldn't sign the transaction: The wallet encountered an internal error.");
  });
});

describe("toWalletError", () => {
  it("passes WalletErrors through", () => {
    const err = new WalletError("TX_TIMEOUT", "late", { txHash: "abc" });
    expect(toWalletError(err)).toBe(err);
  });

  it("recognizes network failures", () => {
    expect(toWalletError(new TypeError("Failed to fetch")).code).toBe("NETWORK");
    expect(toWalletError(new Error("fetch failed")).code).toBe("NETWORK");
  });

  it("wraps anything else with the fallback message", () => {
    const err = toWalletError(new Error("boom"), "Couldn't deposit.");
    expect(err).toMatchObject({ code: "WALLET_ERROR", message: "Couldn't deposit. (boom)" });
  });
});

describe("resultCodeMessage", () => {
  it("explains common transaction result codes", () => {
    expect(resultCodeMessage("txTooLate", "x")).toMatch(/expired/);
    expect(resultCodeMessage("txInsufficientBalance", "x")).toMatch(/XLM/);
    expect(resultCodeMessage("somethingElse", "fallback")).toBe("fallback");
    expect(resultCodeMessage(undefined, "fallback")).toBe("fallback");
  });
});
