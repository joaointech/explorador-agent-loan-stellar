import {
  Account,
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  inspectAuthEntry,
  rpc,
  scValToNative,
  xdr,
  type Operation,
  type Transaction,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContractError, MissingSignerError, TxError } from "./errors";
import { POOL_ID, drawResultScVal } from "./fixtures";
import { scAddress, scBytes, scI128, scU32 } from "./scval";

const OPERATOR = Keypair.random();
const TREASURY = Keypair.random();

const lockCalls: bigint[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: vi.fn(async (_strings: TemplateStringsArray, key: bigint) => {
          lockCalls.push(key);
          return 1;
        }),
      }),
    ),
  },
}));

const server = {
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
};
vi.mock("./rpc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./rpc")>();
  return { ...mod, getRpc: () => server, sleep: async () => {} };
});
vi.mock("./config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./config")>();
  return { ...mod, operatorKeypair: () => OPERATOR, networkConfig: () => ({ ...mod.networkConfig(), networkPassphrase: Networks.TESTNET }) };
});
vi.mock("./deployment", () => ({
  requireDeployment: async () => ({ info: { advancePool: POOL_ID, cpcvNote: POOL_ID, teurc: POOL_ID } }),
}));

const { invokeAsOperator, invokeContract } = await import("./invoke");
const { advisoryLockKey } = await import("./lock");

const txHash = (tx: Transaction) => Buffer.from(tx.hash()).toString("hex");

function simOk(auth: xdr.SorobanAuthorizationEntry[] = [], retval: xdr.ScVal = xdr.ScVal.scvVoid()): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 1_000,
    events: [],
    minResourceFee: "50000",
    transactionData: new SorobanDataBuilder().setResourceFee(50_000),
    result: { auth, retval },
  };
}

/** An unsigned Address-credential auth entry, as simulation (record mode) returns it. */
function addressAuthEntry(signer: string, fn: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(signer).toScAddress(),
        nonce: 42n,
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: Address.fromString(POOL_ID).toScAddress(), functionName: fn, args: [scU32(1)] }),
      ),
      subInvocations: [],
    }),
  });
}

const sourceEntry = (fn: string) =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: addressAuthEntry(OPERATOR.publicKey(), fn).rootInvocation,
  });

const invokeOp = (tx: Transaction) => tx.operations[0] as Operation.InvokeHostFunction;

beforeEach(() => {
  vi.clearAllMocks();
  lockCalls.length = 0;
  server.getAccount.mockImplementation(async (pub: string) => new Account(pub, "100"));
  server.sendTransaction.mockImplementation(async (tx: Transaction) => ({ status: "PENDING", hash: txHash(tx), latestLedger: 1_000, latestLedgerCloseTime: 0 }));
  server.getTransaction.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 1_001, returnValue: xdr.ScVal.scvVoid() });
});

describe("invokeContract", () => {
  it("builds, simulates, assembles, signs, submits, polls and decodes", async () => {
    server.simulateTransaction.mockResolvedValue(simOk([sourceEntry("card_draw")], drawResultScVal(0n, 48_000_000n)));
    server.getTransaction
      .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
      .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 1_002, returnValue: drawResultScVal(0n, 48_000_000n) });

    const res = await invokeContract({
      contractId: POOL_ID,
      fn: "card_draw",
      args: [scAddress(POOL_ID), scI128(48_000_000n), scBytes(new Uint8Array(32), 32)],
      source: OPERATOR,
      decode: (v) => scValToNative(v) as { from_credit: bigint },
    });

    expect(res.ledger).toBe(1_002);
    expect(res.result.from_credit).toBe(48_000_000n);
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    const sent = server.sendTransaction.mock.calls[0][0] as Transaction;
    expect(res.txHash).toBe(txHash(sent));
    expect(sent.source).toBe(OPERATOR.publicKey());
    expect(sent.sequence).toBe("101");
    expect(sent.signatures).toHaveLength(1);
    expect(OPERATOR.verify(Buffer.from(sent.hash()), sent.signatures[0].signature)).toBe(true);
    const op = invokeOp(sent);
    expect(op.func.type).toBe("hostFunctionTypeInvokeContract");
    expect(op.auth).toHaveLength(1);
    // serialized under the operator's advisory lock
    expect(lockCalls).toEqual([advisoryLockKey(OPERATOR.publicKey())]);
  });

  it("signs Address auth entries with the extra signer and re-simulates before submitting", async () => {
    server.simulateTransaction
      .mockResolvedValueOnce(simOk([sourceEntry("settle"), addressAuthEntry(TREASURY.publicKey(), "settle")]))
      .mockResolvedValueOnce(simOk());

    await invokeContract({ contractId: POOL_ID, fn: "settle", args: [scU32(1)], source: OPERATOR, signers: [TREASURY] });

    expect(server.simulateTransaction).toHaveBeenCalledTimes(2);
    const resimulated = server.simulateTransaction.mock.calls[1][0] as Transaction;
    const sent = server.sendTransaction.mock.calls[0][0] as Transaction;
    for (const tx of [resimulated, sent]) {
      const auth = invokeOp(tx).auth ?? [];
      expect(auth).toHaveLength(2);
      const info = inspectAuthEntry(auth[1]);
      expect(info.address).toBe(TREASURY.publicKey());
      expect(info.signed).toBe(true);
      expect(info.signatureExpirationLedger).toBe(1_100);
    }
  });

  it("refuses to submit when an auth entry needs a key we don't hold", async () => {
    server.simulateTransaction.mockResolvedValue(simOk([addressAuthEntry(TREASURY.publicKey(), "settle")]));
    await expect(invokeContract({ contractId: POOL_ID, fn: "settle", args: [scU32(1)], source: OPERATOR })).rejects.toBeInstanceOf(MissingSignerError);
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("surfaces simulation contract errors as ContractError without submitting", async () => {
    server.simulateTransaction.mockResolvedValue({ _parsed: true, id: "1", latestLedger: 1_000, events: [], error: "HostError: Error(Contract, #12)\n…" });
    const err = await invokeContract({ contractId: POOL_ID, fn: "card_draw", args: [], source: OPERATOR }).catch((e) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect(err).toMatchObject({ errorName: "DuplicateDraw", code: "DUPLICATE_DRAW", status: 409 });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("reports an on-chain failure with the tx hash", async () => {
    server.simulateTransaction.mockResolvedValue(simOk());
    server.getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
      ledger: 1_001,
      resultXdr: { result: { type: "txFailed" } },
      diagnosticEventsXdr: [],
    });
    const err = await invokeContract({ contractId: POOL_ID, fn: "cancel", args: [scU32(1)], source: OPERATOR }).catch((e) => e);
    expect(err).toBeInstanceOf(TxError);
    expect(err).toMatchObject({ code: "TX_FAILED", resultCode: "txFailed" });
    expect(err.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retries TRY_AGAIN_LATER and rebuilds once on txBadSeq", async () => {
    server.simulateTransaction.mockResolvedValue(simOk());
    server.getAccount.mockResolvedValueOnce(new Account(OPERATOR.publicKey(), "100")).mockResolvedValueOnce(new Account(OPERATOR.publicKey(), "105"));
    server.sendTransaction
      .mockResolvedValueOnce({ status: "ERROR", hash: "x", errorResult: { result: { type: "txBadSeq" } } })
      .mockResolvedValueOnce({ status: "TRY_AGAIN_LATER", hash: "y" })
      .mockImplementationOnce(async (tx: Transaction) => ({ status: "PENDING", hash: txHash(tx) }));

    const res = await invokeContract({ contractId: POOL_ID, fn: "accrue", args: [], source: OPERATOR });
    expect(server.getAccount).toHaveBeenCalledTimes(2);
    expect((server.sendTransaction.mock.calls[2][0] as Transaction).sequence).toBe("106");
    expect(res.txHash).toBe(txHash(server.sendTransaction.mock.calls[2][0] as Transaction));
  });

  it("serializes concurrent invocations on the same source account", async () => {
    const order: string[] = [];
    server.simulateTransaction.mockResolvedValue(simOk());
    server.getAccount.mockImplementation(async (pub: string) => {
      order.push("getAccount");
      return new Account(pub, "100");
    });
    server.getTransaction.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("final");
      return { status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 1_001, returnValue: xdr.ScVal.scvVoid() };
    });
    await Promise.all([1, 2, 3].map((id) => invokeContract({ contractId: POOL_ID, fn: "cancel", args: [scU32(id)], source: OPERATOR })));
    expect(order).toEqual(["getAccount", "final", "getAccount", "final", "getAccount", "final"]);
  });
});

describe("invokeAsOperator", () => {
  it("targets the deployed contract with the operator as source", async () => {
    server.simulateTransaction.mockResolvedValue(simOk());
    await invokeAsOperator("advancePool", "cancel", [scU32(4)]);
    const sent = server.sendTransaction.mock.calls[0][0] as Transaction;
    expect(sent.source).toBe(OPERATOR.publicKey());
    const fn = invokeOp(sent).func;
    expect(fn.type).toBe("hostFunctionTypeInvokeContract");
    const args = (fn as unknown as { invokeContract: xdr.InvokeContractArgs }).invokeContract;
    expect(String(args.functionName)).toBe("cancel");
    expect(Address.fromScAddress(args.contractAddress).toString()).toBe(POOL_ID);
  });
});
