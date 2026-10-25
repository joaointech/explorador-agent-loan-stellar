// Signed contract invocations (spec §9.3 `invokeAsOperator`): build →
// simulate → sign auth entries → re-simulate → assemble → sign → submit →
// poll until SUCCESS/FAILED → decode the return value. Runs under a per-source
// advisory lock so concurrent callers never collide on the sequence number.

import {
  Account,
  Contract,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  humanizeEvents,
  inspectAuthEntry,
  rpc,
  xdr,
  type Keypair,
  type Transaction,
} from "@stellar/stellar-sdk";

import { networkConfig, operatorKeypair } from "./config";
import { requireDeployment } from "./deployment";
import { ContractError, HostError, MissingSignerError, TxError, parseHostError } from "./errors";
import { withAccountLock } from "./lock";
import { getRpc, rpcCall, sleep } from "./rpc";
import type { ContractKey } from "./simulate";

export interface InvokeResult<T> {
  txHash: string;
  ledger: number;
  result: T;
}

/** Inclusion fee in stroops (resource fees come from simulation). Generous so surge pricing never delays a card draw. */
const INCLUSION_FEE = "10000";
/** Transaction time bounds. */
const TX_TIMEOUT_SECS = 60;
/** Auth entry signatures stay valid this many ledgers (~8 min). */
const AUTH_VALID_LEDGERS = 100;
const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_MS = 75_000;
const SEND_RETRIES = 3;

export interface InvokeParams<T> {
  contractId: string;
  fn: string;
  args: xdr.ScVal[];
  /** Transaction source and fee payer; serialized per account with an advisory lock. */
  source: Keypair;
  /** Keys for Address-credential auth entries (treasury, admin). The source signs its own entries implicitly. */
  signers?: Keypair[];
  /** Decodes the return value; omit for `void` functions. */
  decode?: (retval: xdr.ScVal) => T;
}

/** Invokes a contract function with `source` paying fees, holding the source's lock until the tx is final. */
export async function invokeContract<T = void>(params: InvokeParams<T>): Promise<InvokeResult<T>> {
  return withAccountLock(params.source.publicKey(), async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await buildSignSubmit(params);
      } catch (err) {
        // Another process used the key without the lock: rebuild once with a fresh sequence number.
        if (err instanceof TxError && err.resultCode === "txBadSeq" && attempt < 2) continue;
        throw err;
      }
    }
  });
}

export interface OperatorInvokeOptions<T> {
  /** Extra auth signers: treasury for settle / junior / fees, admin for advance_clock. */
  extraSigners?: Keypair[];
  decode?: (retval: xdr.ScVal) => T;
}

/**
 * `invokeAsOperator(fn, args, extraSigners?)` from spec §9.3, with the target
 * contract named explicitly: the operator is the source and fee payer.
 */
export async function invokeAsOperator<T = void>(
  contract: ContractKey,
  fn: string,
  args: xdr.ScVal[],
  opts: OperatorInvokeOptions<T> = {},
): Promise<InvokeResult<T>> {
  const deployment = await requireDeployment();
  return invokeContract({
    contractId: deployment.info[contract],
    fn,
    args,
    source: operatorKeypair(),
    signers: opts.extraSigners,
    decode: opts.decode,
  });
}

async function simulate(tx: Transaction, fn: string, contractId: string): Promise<rpc.Api.SimulateTransactionSuccessResponse> {
  const sim = await rpcCall(`simulate ${fn}`, () => getRpc().simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw parseHostError(sim.error, fn, contractId);
  if (!sim.result) throw new HostError(fn, "simulation returned no result", "");
  return sim;
}

async function buildSignSubmit<T>(p: InvokeParams<T>): Promise<InvokeResult<T>> {
  const { networkPassphrase } = networkConfig();
  const sourceKey = p.source.publicKey();
  const account = await rpcCall("getAccount", () => getRpc().getAccount(sourceKey));
  const sequence = account.sequenceNumber();
  // TransactionBuilder.build() bumps the account's sequence, so every build starts from a fresh Account.
  const buildTx = (op: xdr.Operation) =>
    new TransactionBuilder(new Account(sourceKey, sequence), { fee: INCLUSION_FEE, networkPassphrase })
      .addOperation(op)
      .setTimeout(TX_TIMEOUT_SECS)
      .build();

  let tx = buildTx(new Contract(p.contractId).call(p.fn, ...p.args));
  let sim = await simulate(tx, p.fn, p.contractId);

  const entries = sim.result?.auth ?? [];
  if (entries.some((e) => e.credentials.type !== "sorobanCredentialsSourceAccount")) {
    const signers = new Map([p.source, ...(p.signers ?? [])].map((k) => [k.publicKey(), k]));
    const validUntil = sim.latestLedger + AUTH_VALID_LEDGERS;
    const signed = await Promise.all(
      entries.map(async (entry) => {
        if (entry.credentials.type === "sorobanCredentialsSourceAccount") return entry;
        const address = inspectAuthEntry(entry).address;
        const signer = address ? signers.get(address) : undefined;
        if (!signer || !address) throw new MissingSignerError(address ?? "unknown address", p.fn);
        return authorizeEntry(entry, signer, validUntil, networkPassphrase);
      }),
    );
    const invoke = tx.operations[0] as Operation.InvokeHostFunction;
    tx = buildTx(Operation.invokeHostFunction({ func: invoke.func, auth: signed }));
    // Enforcing re-simulation: checks the signatures and prices their verification.
    sim = await simulate(tx, p.fn, p.contractId);
  }

  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(p.source);
  return submitAndPoll(prepared, p.fn, p.decode);
}

/** Sends a signed transaction and polls until it is final. Exported for other signed flows (e.g. sponsor-sourced agent txs). */
export async function submitAndPoll<T>(tx: Transaction, fn: string, decode?: (retval: xdr.ScVal) => T): Promise<InvokeResult<T>> {
  const server = getRpc();
  const started = Date.now();
  let sent: rpc.Api.SendTransactionResponse | undefined;
  for (let i = 0; ; i++) {
    sent = await rpcCall(`send ${fn}`, () => server.sendTransaction(tx));
    if (sent.status !== "TRY_AGAIN_LATER" || i >= SEND_RETRIES) break;
    await sleep(1_000 * (i + 1));
  }
  if (sent.status === "ERROR") {
    const code = sent.errorResult?.result.type;
    throw new TxError("TX_REJECTED", `${fn} was rejected by the network (${code ?? "unknown error"})`, null, code);
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    throw new TxError("TX_REJECTED", `${fn}: the network asked to try again later`, null, "TRY_AGAIN_LATER");
  }

  const hash = sent.hash;
  const deadline = Date.now() + POLL_MAX_MS;
  for (;;) {
    let res: rpc.Api.GetTransactionResponse | undefined;
    try {
      res = await server.getTransaction(hash);
    } catch {
      // Transient RPC failure while polling: keep trying until the deadline.
    }
    if (res?.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.info(`[stellar] ${fn} ok ${hash} (ledger ${res.ledger}, ${Date.now() - started} ms)`);
      return { txHash: hash, ledger: res.ledger, result: decode ? decode(res.returnValue ?? xdr.ScVal.scvVoid()) : (undefined as T) };
    }
    if (res?.status === rpc.Api.GetTransactionStatus.FAILED) throw failedTxError(res, fn, hash);
    if (Date.now() > deadline) {
      throw new TxError("TX_TIMEOUT", `${fn}: transaction ${hash} not confirmed after ${POLL_MAX_MS / 1000} s`, hash);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Best-effort decoding of an on-chain failure: the contract error from diagnostic events, else the result code. */
function failedTxError(res: rpc.Api.GetFailedTransactionResponse, fn: string, hash: string): Error {
  try {
    for (const ev of humanizeEvents(res.diagnosticEventsXdr ?? [])) {
      const [topic, err] = ev.topics as unknown[];
      if (topic === "error" && err && typeof err === "object" && (err as { type?: unknown }).type === "contract") {
        return new ContractError(Number((err as { code: unknown }).code), fn, undefined, hash);
      }
    }
  } catch {
    // fall through to the result code
  }
  const code = res.resultXdr?.result.type;
  return new TxError("TX_FAILED", `${fn} failed on-chain (${code ?? "unknown"}), tx ${hash}`, hash, code);
}
