import { describe, expect, it } from "vitest";

import { HttpError } from "@/lib/http";

import { ContractError, ContractMissingError, HostError, isContractError, parseHostError, toScreamingSnake } from "./errors";

// Strings captured from testnet simulateTransaction (RPC 30.0.0, protocol 29).
const CONTRACT_ERROR = `HostError: Error(Contract, #8)

Event log (newest first):
   0: [Diagnostic Event] contract:CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC, topics:[error, Error(Contract, #8)], data:["negative amount is not allowed", -5]
   1: [Diagnostic Event] topics:[fn_call, CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC, transfer], data:[GAAA…WHF, GAAA…WHF, -5]`;

const MISSING_INSTANCE = `HostError: Error(Storage, MissingValue)

Event log (newest first):
   0: [Diagnostic Event] topics:[error, Error(Storage, MissingValue)], data:"trying to get non-existing value for contract instance"
   1: [Diagnostic Event] topics:[fn_call, CCX6TGKIOAJYT6KWVBSV3J7RJZVDVN6YKGY5RL3CXSE6PZPEI7DF3CWF, stats], data:Void`;

describe("parseHostError", () => {
  it("maps Error(Contract, #n) to a named ContractError HttpError", () => {
    const err = parseHostError(CONTRACT_ERROR.replace("#8", "#10"), "write_off");
    expect(err).toBeInstanceOf(ContractError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, code: "GRACE_NOT_OVER", errorName: "GraceNotOver", contractCode: 10 });
    expect(isContractError(err, "GraceNotOver")).toBe(true);
    expect(err.message).toContain("negative amount is not allowed");
  });

  it("uses specific statuses for not-found / auth / bad input", () => {
    expect(parseHostError("Error(Contract, #18)", "get")).toMatchObject({ status: 404, code: "UNKNOWN_NOTE" });
    expect(parseHostError("Error(Contract, #1)", "settle")).toMatchObject({ status: 403, code: "NOT_AUTHORIZED" });
    expect(parseHostError("Error(Contract, #13)", "mint")).toMatchObject({ status: 400, code: "INVALID_PROOF" });
    expect(parseHostError("Error(Contract, #12)", "card_draw")).toMatchObject({ status: 409, code: "DUPLICATE_DRAW" });
    expect(parseHostError("Error(Contract, #999)", "x")).toMatchObject({ status: 409, code: "CONTRACT_ERROR999" });
  });

  it("detects a contract that is not on the network", () => {
    const err = parseHostError(MISSING_INSTANCE, "stats", "CCX6TGKIOAJYT6KWVBSV3J7RJZVDVN6YKGY5RL3CXSE6PZPEI7DF3CWF");
    expect(err).toBeInstanceOf(ContractMissingError);
    expect(err).toMatchObject({ status: 503, code: "CONTRACT_MISSING" });
  });

  it("falls back to a HostError for other host failures", () => {
    const err = parseHostError("HostError: Error(Budget, ExceededLimit)\n…", "mint");
    expect(err).toBeInstanceOf(HostError);
    expect(err.message).toContain("Error(Budget, ExceededLimit)");
  });
});

describe("toScreamingSnake", () => {
  it("converts contract error names", () => {
    expect(toScreamingSnake("InsufficientLiquidity")).toBe("INSUFFICIENT_LIQUIDITY");
    expect(toScreamingSnake("VaultExceededMaxWithdraw")).toBe("VAULT_EXCEEDED_MAX_WITHDRAW");
  });
});
