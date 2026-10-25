// Test doubles for the client-side wallet flows: a mocked Soroban RPC, a
// keypair signer standing in for Freighter, and helpers to inspect the
// transactions the code under test builds. Used by unit tests only.

import { Address, Keypair, SorobanDataBuilder, StrKey, TransactionBuilder, xdr, type Operation, type Transaction } from "@stellar/stellar-sdk/base";
import { Api } from "@stellar/stellar-sdk/rpc";
import { vi } from "vitest";

import { TESTNET_PASSPHRASE } from "../constants";
import type { RpcLike, SignTransaction } from "../soroban";

export const PASSPHRASE = TESTNET_PASSPHRASE;
export const POOL_ID = StrKey.encodeContract(new Uint8Array(32).fill(3));
export const TEURC_ID = StrKey.encodeContract(new Uint8Array(32).fill(1));
export const DEPLOYMENT = { advancePool: POOL_ID, teurc: TEURC_ID, networkPassphrase: PASSPHRASE };

export interface MockRpc {
  getLedgerEntries: ReturnType<typeof vi.fn>;
  simulateTransaction: ReturnType<typeof vi.fn>;
  sendTransaction: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
}

export const createMockRpc = (): MockRpc => ({
  getLedgerEntries: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
});

/** The mock typed as the RPC the wallet code expects. */
export const asRpc = (m: MockRpc) => m as unknown as RpcLike;

/** A successful simulation returning `retval`. */
export function simOk(retval: xdr.ScVal = xdr.ScVal.scvVoid(), auth: xdr.SorobanAuthorizationEntry[] = []): Api.SimulateTransactionSuccessResponse {
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

export const simError = (error: string): Api.SimulateTransactionErrorResponse => ({ _parsed: true, id: "1", latestLedger: 1_000, events: [], error });

/** getLedgerEntries response for an existing account. */
export const accountEntry = (sequence: bigint, balance: bigint) => ({
  latestLedger: 1_000,
  entries: [{ key: {}, val: { type: "account", value: { seqNum: sequence, balance } } }],
});

export const noEntries = () => ({ latestLedger: 1_000, entries: [] });

export const txHash = (tx: Transaction): string => Buffer.from(tx.hash()).toString("hex");

/** Stands in for Freighter: signs the envelope with `kp`. */
export const keypairSigner =
  (kp: Keypair): SignTransaction =>
  async (txXdr, { networkPassphrase }) => {
    const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase) as Transaction;
    tx.sign(kp);
    return tx.toXDR();
  };

/** Contract, function name and arguments of a one-operation invocation. */
export function invocationOf(tx: Transaction): { contractId: string; method: string; args: xdr.ScVal[] } {
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  const call = (op.func as unknown as { invokeContract: xdr.InvokeContractArgs }).invokeContract;
  return { contractId: Address.fromScAddress(call.contractAddress).toString(), method: String(call.functionName), args: call.args };
}

/** A diagnostic event carrying `Error(Contract, #code)`, as a failed transaction reports it. */
export function contractErrorEvent(code: number): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({ topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(code))], data: xdr.ScVal.scvVoid() }),
      ),
    }),
  });
}

/** Default happy-path wiring: funded account, PENDING submission, SUCCESS on the first poll. */
export function wireHappyPath(rpc: MockRpc, opts: { sequence?: bigint; returnValue?: xdr.ScVal } = {}) {
  rpc.getLedgerEntries.mockResolvedValue(accountEntry(opts.sequence ?? 100n, 100_000_000_000n));
  rpc.simulateTransaction.mockResolvedValue(simOk(opts.returnValue));
  rpc.sendTransaction.mockImplementation(async (tx: Transaction) => ({ status: "PENDING", hash: txHash(tx), latestLedger: 1_000, latestLedgerCloseTime: 0 }));
  rpc.getTransaction.mockResolvedValue({
    status: Api.GetTransactionStatus.SUCCESS,
    ledger: 1_001,
    returnValue: opts.returnValue ?? xdr.ScVal.scvVoid(),
  });
}

export { Keypair };
