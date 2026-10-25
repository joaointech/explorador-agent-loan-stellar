// Client-side Soroban transactions for Freighter users (spec §4.1):
//   load account → Contract(id).call(fn, …args) → simulate → assemble →
//   sign (Freighter) → send → poll until SUCCESS/FAILED,
// plus read-only calls via simulation. The RPC server and the signer are
// injected, so the whole flow is unit-tested with a mocked RPC.

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  humanizeEvents,
  nativeToScVal,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk/base";
import { Api, Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

import { INCLUSION_FEE, NULL_ACCOUNT, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, TX_TIMEOUT_SECS } from "./constants";
import { WalletError, contractError, parseSimulationError, resultCodeMessage, toWalletError } from "./errors";

/** The RPC methods the wallet flows use (an `rpc.Server`, or a mock in tests). */
export type RpcLike = Pick<Server, "getLedgerEntries" | "simulateTransaction" | "sendTransaction" | "getTransaction">;

const servers = new Map<string, Server>();

/** Shared RPC client per URL (browser-side). */
export function getRpc(rpcUrl: string): Server {
  let server = servers.get(rpcUrl);
  if (!server) {
    server = new Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://"), timeout: 20_000 });
    servers.set(rpcUrl, server);
  }
  return server;
}

// ---------- argument encoders ----------

/** i128 amount (stroops or shares). */
export const i128 = (value: bigint): xdr.ScVal => nativeToScVal(value, { type: "i128" });
/** G… account or C… contract address. */
export const address = (strkey: string): xdr.ScVal => Address.fromString(strkey).toScVal();

/** Decodes an integer return value (i128, u64, u32) as bigint. */
export function toBigInt(retval: xdr.ScVal, what: string): bigint {
  const native: unknown = scValToNative(retval);
  if (typeof native === "bigint") return native;
  if (typeof native === "number" && Number.isInteger(native)) return BigInt(native);
  throw new WalletError("SIMULATION_FAILED", `${what} returned an unexpected value.`);
}

// ---------- accounts ----------

export interface AccountInfo {
  address: string;
  /** Current sequence number (the next transaction uses sequence + 1). */
  sequence: string;
  /** Native balance in stroops of XLM. */
  xlm: bigint;
}

/**
 * The account's sequence and XLM balance, or null when it doesn't exist yet
 * (never funded). Uses getLedgerEntries directly: `rpc.Server.getAccount`
 * reports network failures as "Account not found", which would wrongly send
 * people to Friendbot.
 */
export async function loadAccount(rpc: Pick<RpcLike, "getLedgerEntries">, accountId: string): Promise<AccountInfo | null> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(accountId).xdrPublicKey() }));
  let res: Awaited<ReturnType<RpcLike["getLedgerEntries"]>>;
  try {
    res = await rpc.getLedgerEntries(key);
  } catch (err) {
    throw toWalletError(err, "Couldn't load your account.");
  }
  const entry = res.entries[0];
  if (!entry) return null;
  if (entry.val.type !== "account") throw new WalletError("WALLET_ERROR", "Unexpected ledger entry for your account.");
  const account = entry.val.value;
  return { address: accountId, sequence: account.seqNum.toString(), xlm: account.balance };
}

// ---------- building and reading ----------

export interface InvocationSpec {
  networkPassphrase: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}

/** A one-operation transaction invoking `contractId.method(args)`. */
export function buildInvocation(
  spec: InvocationSpec & { source: string; sequence: string; fee?: string; timeoutSecs?: number },
): Transaction {
  return new TransactionBuilder(new Account(spec.source, spec.sequence), {
    fee: spec.fee ?? INCLUSION_FEE,
    networkPassphrase: spec.networkPassphrase,
  })
    .addOperation(new Contract(spec.contractId).call(spec.method, ...spec.args))
    .setTimeout(spec.timeoutSecs ?? TX_TIMEOUT_SECS)
    .build();
}

async function simulate(rpc: Pick<RpcLike, "simulateTransaction">, tx: Transaction): Promise<Api.SimulateTransactionSuccessResponse> {
  let sim: Api.SimulateTransactionResponse;
  try {
    sim = await rpc.simulateTransaction(tx);
  } catch (err) {
    throw toWalletError(err, "Couldn't simulate the transaction.");
  }
  if (Api.isSimulationError(sim)) throw parseSimulationError(sim.error);
  return sim;
}

/** Read-only call via simulation; returns the raw return value. No account or signature needed. */
export async function simulateRead(rpc: Pick<RpcLike, "simulateTransaction">, spec: InvocationSpec): Promise<xdr.ScVal> {
  const tx = buildInvocation({ ...spec, source: NULL_ACCOUNT, sequence: "0", fee: BASE_FEE, timeoutSecs: 30 });
  const sim = await simulate(rpc, tx);
  if (!sim.result) throw new WalletError("SIMULATION_FAILED", `${spec.method} returned no result.`);
  return sim.result.retval;
}

// ---------- signed invocations ----------

export type TxPhase = "preparing" | "signing" | "submitting" | "confirming";

/** Signs a transaction envelope (base64 XDR) and returns the signed envelope. Freighter in the app. */
export type SignTransaction = (txXdr: string, opts: { networkPassphrase: string; address: string }) => Promise<string>;

export interface InvokeParams extends InvocationSpec {
  rpc: RpcLike;
  /** The investor's G… address: transaction source, fee payer and signer. */
  source: string;
  sign: SignTransaction;
  onPhase?: (phase: TxPhase, info?: { txHash?: string }) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface InvokeOutcome {
  txHash: string;
  ledger: number;
  returnValue: xdr.ScVal;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Invokes a contract function signed by `source` (Freighter). The source
 * account's own authorizations (e.g. `operator.require_auth()` in deposit
 * and the tEURC transfer under it) come back from simulation as
 * source-account credentials, so the envelope signature covers them.
 */
export async function invokeContract(p: InvokeParams): Promise<InvokeOutcome> {
  const sleep = p.sleep ?? defaultSleep;
  p.onPhase?.("preparing");
  const account = await loadAccount(p.rpc, p.source);
  if (!account) throw new WalletError("ACCOUNT_NOT_FUNDED", "Your account isn't on testnet yet. Use “Get test XLM” first.");

  const tx = buildInvocation({ ...p, sequence: account.sequence });
  const sim = await simulate(p.rpc, tx);
  if (Api.isSimulationRestore(sim)) {
    throw new WalletError("SIMULATION_FAILED", "Some contract data is archived on testnet and needs a restore first. Please try again later.");
  }
  const prepared = assembleTransaction(tx, sim).build();

  p.onPhase?.("signing");
  const signedXdr = await p.sign(prepared.toXDR(), { networkPassphrase: p.networkPassphrase, address: p.source });
  let signed: Transaction;
  try {
    signed = TransactionBuilder.fromXDR(signedXdr, p.networkPassphrase) as Transaction;
  } catch (err) {
    throw toWalletError(err, "Freighter returned an unreadable transaction.");
  }

  p.onPhase?.("submitting");
  const txHash = await submit(p.rpc, signed, sleep);

  p.onPhase?.("confirming", { txHash });
  return poll(p.rpc, txHash, sleep, p.pollIntervalMs ?? POLL_INTERVAL_MS, p.pollTimeoutMs ?? POLL_TIMEOUT_MS);
}

async function submit(rpc: Pick<RpcLike, "sendTransaction">, tx: Transaction, sleep: (ms: number) => Promise<void>): Promise<string> {
  let sent: Api.SendTransactionResponse;
  for (let attempt = 0; ; attempt++) {
    try {
      sent = await rpc.sendTransaction(tx);
    } catch (err) {
      throw toWalletError(err, "Couldn't submit the transaction.");
    }
    if (sent.status !== "TRY_AGAIN_LATER" || attempt >= 2) break;
    await sleep(1_000 * (attempt + 1));
  }
  if (sent.status === "ERROR") {
    const code = sent.errorResult?.result.type;
    throw new WalletError("TX_REJECTED", resultCodeMessage(code, `The network rejected the transaction (${code ?? "unknown error"}).`), { resultCode: code });
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    throw new WalletError("TX_REJECTED", "The network is busy. Please try again in a moment.", { resultCode: "TRY_AGAIN_LATER" });
  }
  // PENDING, or DUPLICATE (already submitted): either way, poll for the outcome.
  return sent.hash;
}

async function poll(
  rpc: Pick<RpcLike, "getTransaction">,
  txHash: string,
  sleep: (ms: number) => Promise<void>,
  intervalMs: number,
  timeoutMs: number,
): Promise<InvokeOutcome> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < attempts; i++) {
    let res: Api.GetTransactionResponse | undefined;
    try {
      res = await rpc.getTransaction(txHash);
    } catch {
      // A transient RPC failure while polling: keep trying until the budget runs out.
    }
    if (res?.status === Api.GetTransactionStatus.SUCCESS) {
      return { txHash, ledger: res.ledger, returnValue: res.returnValue ?? xdr.ScVal.scvVoid() };
    }
    if (res?.status === Api.GetTransactionStatus.FAILED) throw failedTransaction(res, txHash);
    if (i < attempts - 1) await sleep(intervalMs);
  }
  throw new WalletError("TX_TIMEOUT", `Not confirmed after ${Math.round(timeoutMs / 1000)} s. Check the transaction on stellar.expert.`, { txHash });
}

/** The contract error code in a failed transaction's diagnostic events, if any. */
export function contractCodeFromEvents(events: Parameters<typeof humanizeEvents>[0]): number | undefined {
  try {
    for (const event of humanizeEvents(events)) {
      const [topic, err] = event.topics as unknown[];
      if (topic === "error" && err && typeof err === "object" && (err as { type?: unknown }).type === "contract") {
        return Number((err as { code: unknown }).code);
      }
    }
  } catch {
    // Unreadable events: fall back to the result code.
  }
  return undefined;
}

/** "invokeHostFunctionTrapped" etc. from a failed result, else the transaction code ("txFailed"). */
function resultCodeOf(result: unknown): string | undefined {
  const r = result as {
    result?: { type?: string; results?: { type?: string; tr?: { type?: string; invokeHostFunctionResult?: { type?: string } } }[] };
  } | undefined;
  const op = r?.result?.results?.[0];
  return op?.tr?.invokeHostFunctionResult?.type ?? (op?.type && op.type !== "opInner" ? op.type : undefined) ?? r?.result?.type;
}

function failedTransaction(res: Api.GetFailedTransactionResponse, txHash: string): WalletError {
  const code = contractCodeFromEvents(res.diagnosticEventsXdr ?? []);
  if (code !== undefined) return contractError(code, { txHash });
  const resultCode = resultCodeOf(res.resultXdr);
  return new WalletError("TX_FAILED", resultCodeMessage(resultCode, `The transaction failed on-chain (${resultCode ?? "unknown error"}).`), {
    txHash,
    resultCode,
  });
}
