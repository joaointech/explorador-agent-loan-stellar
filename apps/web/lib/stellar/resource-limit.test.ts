import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { resourceLimitExceeded } from "./envelope";

const txResult = (op: xdr.InvokeHostFunctionResult) =>
  new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txFailed([xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(op))]),
    ext: xdr.TransactionResultExt.v0(),
  });

describe("resourceLimitExceeded", () => {
  it("recognises a transaction that ran out of its simulated resources", () => {
    expect(resourceLimitExceeded(txResult(xdr.InvokeHostFunctionResult.invokeHostFunctionResourceLimitExceeded()))).toBe(true);
  });

  it("ignores other failures and missing results", () => {
    expect(resourceLimitExceeded(txResult(xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped()))).toBe(false);
    expect(resourceLimitExceeded(undefined)).toBe(false);
  });
});
