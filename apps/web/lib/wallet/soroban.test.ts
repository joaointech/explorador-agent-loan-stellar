import { Keypair, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk/base";
import { Api } from "@stellar/stellar-sdk/rpc";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NULL_ACCOUNT } from "./constants";
import { WalletError } from "./errors";
import { address, buildInvocation, i128, invokeContract, loadAccount, simulateRead, toBigInt, type TxPhase } from "./soroban";
import {
  PASSPHRASE,
  POOL_ID,
  accountEntry,
  asRpc,
  contractErrorEvent,
  createMockRpc,
  invocationOf,
  keypairSigner,
  noEntries,
  simError,
  simOk,
  txHash,
  wireHappyPath,
  type MockRpc,
} from "./testing/mock-rpc";

const INVESTOR = Keypair.random();
const noSleep = async () => {};

let rpc: MockRpc;
beforeEach(() => {
  rpc = createMockRpc();
});

function invoke(overrides: Partial<Parameters<typeof invokeContract>[0]> = {}) {
  return invokeContract({
    rpc: asRpc(rpc),
    networkPassphrase: PASSPHRASE,
    contractId: POOL_ID,
    method: "deposit",
    args: [i128(5_000n), address(INVESTOR.publicKey())],
    source: INVESTOR.publicKey(),
    sign: keypairSigner(INVESTOR),
    sleep: noSleep,
    ...overrides,
  });
}

describe("encoders", () => {
  it("encodes amounts as i128 and addresses as ScAddress", () => {
    const amount = i128(123_456_789_012_345_678_901n);
    expect(amount.type).toBe("scvI128");
    expect(scValToNative(amount)).toBe(123_456_789_012_345_678_901n);
    expect(address(INVESTOR.publicKey()).type).toBe("scvAddress");
    expect(scValToNative(address(POOL_ID))).toBe(POOL_ID);
  });

  it("decodes integer return values as bigint", () => {
    expect(toBigInt(i128(42n), "x")).toBe(42n);
    expect(toBigInt(xdr.ScVal.scvU32(7), "x")).toBe(7n);
    expect(() => toBigInt(xdr.ScVal.scvBool(true), "x")).toThrow(WalletError);
  });

  it("builds a one-operation invocation with the given source and sequence", () => {
    const tx = buildInvocation({ networkPassphrase: PASSPHRASE, contractId: POOL_ID, method: "balance", args: [address(INVESTOR.publicKey())], source: INVESTOR.publicKey(), sequence: "41" });
    expect(tx.source).toBe(INVESTOR.publicKey());
    expect(tx.sequence).toBe("42");
    expect(invocationOf(tx)).toMatchObject({ contractId: POOL_ID, method: "balance" });
  });
});

describe("loadAccount", () => {
  it("returns the sequence and XLM balance", async () => {
    rpc.getLedgerEntries.mockResolvedValue(accountEntry(77n, 99_000_000n));
    await expect(loadAccount(asRpc(rpc), INVESTOR.publicKey())).resolves.toEqual({ address: INVESTOR.publicKey(), sequence: "77", xlm: 99_000_000n });
  });

  it("returns null for an account that was never funded", async () => {
    rpc.getLedgerEntries.mockResolvedValue(noEntries());
    await expect(loadAccount(asRpc(rpc), INVESTOR.publicKey())).resolves.toBeNull();
  });

  it("reports RPC outages as network errors, not as a missing account", async () => {
    rpc.getLedgerEntries.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(loadAccount(asRpc(rpc), INVESTOR.publicKey())).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("simulateRead", () => {
  it("simulates from the null account and returns the raw return value", async () => {
    rpc.simulateTransaction.mockResolvedValue(simOk(i128(9_876n)));
    const retval = await simulateRead(asRpc(rpc), { networkPassphrase: PASSPHRASE, contractId: POOL_ID, method: "preview_deposit", args: [i128(10_000n)] });
    expect(scValToNative(retval)).toBe(9_876n);
    const tx = rpc.simulateTransaction.mock.calls[0][0] as Transaction;
    expect(tx.source).toBe(NULL_ACCOUNT);
    const call = invocationOf(tx);
    expect(call.method).toBe("preview_deposit");
    expect(scValToNative(call.args[0])).toBe(10_000n);
  });

  it("maps contract errors to investor-facing messages", async () => {
    rpc.simulateTransaction.mockResolvedValue(simError("HostError: Error(Contract, #5)\n\nEvent log (newest first): …"));
    const err = await simulateRead(asRpc(rpc), { networkPassphrase: PASSPHRASE, contractId: POOL_ID, method: "withdraw", args: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(WalletError);
    expect(err).toMatchObject({ code: "CONTRACT_ERROR", contractCode: 5 });
    expect(err.message).toMatch(/liquidity/i);
  });

  it("recognizes contracts that are gone (testnet reset)", async () => {
    rpc.simulateTransaction.mockResolvedValue(simError("HostError: Error(Storage, MissingValue)\n\nEvent log: trying to get non-existing value for contract instance"));
    await expect(simulateRead(asRpc(rpc), { networkPassphrase: PASSPHRASE, contractId: POOL_ID, method: "stats", args: [] })).rejects.toMatchObject({
      code: "CONTRACT_MISSING",
    });
  });
});

describe("invokeContract", () => {
  it("loads the account, simulates, assembles, signs, submits and polls", async () => {
    wireHappyPath(rpc, { sequence: 100n, returnValue: i128(4_987n) });
    rpc.getTransaction
      .mockResolvedValueOnce({ status: Api.GetTransactionStatus.NOT_FOUND })
      .mockResolvedValueOnce({ status: Api.GetTransactionStatus.SUCCESS, ledger: 1_002, returnValue: i128(4_987n) });
    const sign = vi.fn(keypairSigner(INVESTOR));
    const phases: [TxPhase, string | undefined][] = [];

    const out = await invoke({ sign, onPhase: (phase, info) => phases.push([phase, info?.txHash]) });

    expect(scValToNative(out.returnValue)).toBe(4_987n);
    expect(out.ledger).toBe(1_002);
    const sent = rpc.sendTransaction.mock.calls[0][0] as Transaction;
    expect(out.txHash).toBe(txHash(sent));
    expect(phases).toEqual([
      ["preparing", undefined],
      ["signing", undefined],
      ["submitting", undefined],
      ["confirming", out.txHash],
    ]);

    // The signer saw the assembled transaction: resource fee and footprint from simulation.
    expect(sign).toHaveBeenCalledWith(expect.any(String), { networkPassphrase: PASSPHRASE, address: INVESTOR.publicKey() });
    expect(Number(sent.fee)).toBe(10_000 + 50_000);
    expect(sent.sequence).toBe("101");
    expect(sent.signatures).toHaveLength(1);
    expect(INVESTOR.verify(Buffer.from(sent.hash()), sent.signatures[0].signature)).toBe(true);
    const call = invocationOf(sent);
    expect(call).toMatchObject({ contractId: POOL_ID, method: "deposit" });
    expect(call.args.map((a) => a.type)).toEqual(["scvI128", "scvAddress"]);
    expect(rpc.getTransaction).toHaveBeenCalledTimes(2);
  });

  it("asks for test XLM when the account doesn't exist, before any signature", async () => {
    rpc.getLedgerEntries.mockResolvedValue(noEntries());
    const sign = vi.fn();
    await expect(invoke({ sign })).rejects.toMatchObject({ code: "ACCOUNT_NOT_FUNDED" });
    expect(sign).not.toHaveBeenCalled();
    expect(rpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("surfaces simulation failures without prompting Freighter", async () => {
    wireHappyPath(rpc);
    rpc.simulateTransaction.mockResolvedValue(simError("HostError: Error(Contract, #100)\n…"));
    const sign = vi.fn();
    const err = await invoke({ sign }).catch((e) => e);
    expect(err).toMatchObject({ code: "CONTRACT_ERROR", contractCode: 100 });
    expect(err.message).toMatch(/balance is too low/);
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses to submit when simulation needs a state restore", async () => {
    wireHappyPath(rpc);
    rpc.simulateTransaction.mockResolvedValue({ ...simOk(), restorePreamble: { minResourceFee: "1", transactionData: simOk().transactionData } });
    await expect(invoke()).rejects.toMatchObject({ code: "SIMULATION_FAILED" });
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("stops when the user rejects the request in Freighter", async () => {
    wireHappyPath(rpc);
    const declined = new WalletError("USER_DECLINED", "You rejected the request in Freighter.");
    await expect(invoke({ sign: async () => Promise.reject(declined) })).rejects.toBe(declined);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("explains network rejections (e.g. no XLM for the fee)", async () => {
    wireHappyPath(rpc);
    rpc.sendTransaction.mockResolvedValue({ status: "ERROR", hash: "x", errorResult: { result: { type: "txInsufficientBalance" } } });
    const err = await invoke().catch((e) => e);
    expect(err).toMatchObject({ code: "TX_REJECTED", resultCode: "txInsufficientBalance" });
    expect(err.message).toMatch(/XLM/);
    expect(rpc.getTransaction).not.toHaveBeenCalled();
  });

  it("retries TRY_AGAIN_LATER before giving up", async () => {
    wireHappyPath(rpc);
    rpc.sendTransaction
      .mockResolvedValueOnce({ status: "TRY_AGAIN_LATER", hash: "y" })
      .mockImplementationOnce(async (tx: Transaction) => ({ status: "PENDING", hash: txHash(tx) }));
    const out = await invoke();
    expect(rpc.sendTransaction).toHaveBeenCalledTimes(2);
    expect(out.txHash).toMatch(/^[0-9a-f]{64}$/);

    rpc.sendTransaction.mockResolvedValue({ status: "TRY_AGAIN_LATER", hash: "z" });
    await expect(invoke()).rejects.toMatchObject({ code: "TX_REJECTED", resultCode: "TRY_AGAIN_LATER" });
  });

  it("decodes the contract error of a transaction that failed on-chain", async () => {
    wireHappyPath(rpc);
    rpc.getTransaction.mockResolvedValue({ status: Api.GetTransactionStatus.FAILED, ledger: 1_001, diagnosticEventsXdr: [contractErrorEvent(5)] });
    const err = await invoke().catch((e) => e);
    expect(err).toMatchObject({ code: "CONTRACT_ERROR", contractCode: 5 });
    expect(err.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back to the operation result code when there is no contract error", async () => {
    wireHappyPath(rpc);
    rpc.getTransaction.mockResolvedValue({
      status: Api.GetTransactionStatus.FAILED,
      ledger: 1_001,
      diagnosticEventsXdr: [],
      resultXdr: { result: { type: "txFailed", results: [{ type: "opInner", tr: { type: "invokeHostFunction", invokeHostFunctionResult: { type: "invokeHostFunctionTrapped" } } }] } },
    });
    const err = await invoke().catch((e) => e);
    expect(err).toMatchObject({ code: "TX_FAILED", resultCode: "invokeHostFunctionTrapped" });
    expect(err.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("times out with the hash when the transaction never shows up", async () => {
    wireHappyPath(rpc);
    rpc.getTransaction.mockResolvedValue({ status: Api.GetTransactionStatus.NOT_FOUND });
    const err = await invoke({ pollIntervalMs: 1_000, pollTimeoutMs: 5_000 }).catch((e) => e);
    expect(err).toMatchObject({ code: "TX_TIMEOUT" });
    expect(err.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc.getTransaction).toHaveBeenCalledTimes(5);
  });

  it("keeps polling through transient RPC errors", async () => {
    wireHappyPath(rpc);
    rpc.getTransaction
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ status: Api.GetTransactionStatus.SUCCESS, ledger: 1_005, returnValue: xdr.ScVal.scvVoid() });
    await expect(invoke()).resolves.toMatchObject({ ledger: 1_005 });
  });
});
