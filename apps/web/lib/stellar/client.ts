// Generic Soroban access (§9.3):
// - readContract: simulate a view call and decode it with the contract spec.
// - invoke: build → simulate → sign auth entries → re-simulate → sign → submit → poll,
//   serialized per source key with a Postgres advisory lock so concurrent card draws
//   never collide on sequence numbers.
import {
  Account,
  Address,
  authorizeEntry,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  rpc,
  scValToNative,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
  type FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { contractId, spec, type ContractName } from "./contracts";
import { ContractCallError, decodeContractError } from "./errors";
import { keypair, publicKey, rpcServer, withTimeout, type Role } from "./network";

export type Args = Record<string, unknown>;

function unwrapResult(v: unknown): unknown {
  // contract.Spec wraps Result<T, E> outputs in Ok/Err.
  if (v && typeof v === "object" && "unwrap" in v && typeof (v as { unwrap: unknown }).unwrap === "function") {
    return (v as { unwrap: () => unknown }).unwrap();
  }
  return v;
}

export function encodeArgs(name: ContractName, fn: string, args: Args): xdr.ScVal[] {
  return spec(name).funcArgsToScVals(fn, args);
}

export function decodeResult<T>(name: ContractName, fn: string, retval: xdr.ScVal | undefined): T {
  if (!retval) return undefined as T;
  try {
    return unwrapResult(spec(name).funcResToNative(fn, retval)) as T;
  } catch {
    return scValToNative(retval) as T;
  }
}

function buildTx(source: Account, op: xdr.Operation, timeout = 60): Transaction {
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(op)
    .setTimeout(timeout)
    .build();
}

export async function simulateOp(op: xdr.Operation, source = publicKey("sponsor"), timeoutMs?: number) {
  const tx = buildTx(new Account(source, "0"), op);
  const p = rpcServer().simulateTransaction(tx);
  const sim = timeoutMs ? await withTimeout(p, timeoutMs, "simulation") : await p;
  if (rpc.Api.isSimulationError(sim)) throw decodeContractError(sim.error);
  return sim as rpc.Api.SimulateTransactionSuccessResponse;
}

export async function readContract<T = unknown>(
  name: ContractName,
  fn: string,
  args: Args = {},
  opts: { timeoutMs?: number; contract?: string } = {},
): Promise<T> {
  const id = opts.contract ?? (await contractId(name));
  const op = new Contract(id).call(fn, ...encodeArgs(name, fn, args));
  const sim = await simulateOp(op, undefined, opts.timeoutMs);
  return decodeResult<T>(name, fn, sim.result?.retval);
}

// ---------------------------------------------------------------- submission

export interface SubmitResult {
  hash: string;
  ledger: number;
  returnValue?: xdr.ScVal;
  events: xdr.DiagnosticEvent[];
}

function lockKey(pub: string): bigint {
  const h = createHash("sha256").update(`ea-seq:${pub}`).digest();
  return h.readBigInt64BE(0);
}

/** Serializes everything signed by one source account across processes. */
export async function withSourceLock<T>(sourcePub: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(sourcePub);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${key.toString()})::text AS locked`);
      return fn();
    },
    { timeout: 180_000, maxWait: 180_000 },
  );
}

export async function waitForTx(hash: string, timeoutMs = 90_000): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const server = rpcServer();
  const start = Date.now();
  for (;;) {
    const r = await server.getTransaction(hash);
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return r;
    if (r.status === rpc.Api.GetTransactionStatus.FAILED) {
      const diag = (r.diagnosticEventsXdr ?? []).map((d) => JSON.stringify(scValToNativeSafe(d))).join(" ");
      throw decodeContractError(`Transaction ${hash} failed: ${r.resultXdr?.result().switch().name ?? ""} ${diag}`);
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Transaction ${hash} not confirmed after ${timeoutMs} ms`);
    await new Promise((res) => setTimeout(res, 1000));
  }
}

function scValToNativeSafe(d: xdr.DiagnosticEvent): unknown {
  try {
    const body = d.event().body().v0();
    return { topics: body.topics().map((t) => safeNative(t)), data: safeNative(body.data()) };
  } catch {
    return null;
  }
}

function safeNative(v: xdr.ScVal): unknown {
  try {
    return scValToNative(v);
  } catch {
    return v.switch().name;
  }
}

const UINT32_MAX = 4_294_967_295n;

/**
 * Assembles the simulated tx and signs it. When the resource fee exceeds the uint32 fee
 * field (testnet rent surcharge, e.g. wasm uploads), it does what the Stellar CLI does:
 * inner fee 0 with the real resourceFee in sorobanData, wrapped in an int64 fee bump.
 */
export function assembleSigned(tx: Transaction, sim: rpc.Api.SimulateTransactionSuccessResponse, kp: Keypair): Transaction | FeeBumpTransaction {
  const resourceFee = BigInt(sim.minResourceFee);
  if (resourceFee + BigInt(tx.fee) <= UINT32_MAX) {
    const assembled = rpc.assembleTransaction(tx, sim).build();
    assembled.sign(kp);
    return assembled;
  }
  const zeroed = xdr.SorobanTransactionData.fromXDR(sim.transactionData.build().toXDR());
  zeroed.resourceFee(xdr.Int64.fromString("0"));
  const assembled = rpc.assembleTransaction(tx, { ...sim, minResourceFee: "0", transactionData: new SorobanDataBuilder(zeroed) }).build();
  const envelope = assembled.toEnvelope();
  envelope.v1().tx().fee(0);
  envelope.v1().tx().ext().sorobanData().resourceFee(xdr.Int64.fromString(resourceFee.toString()));
  const inner = new Transaction(envelope, env.networkPassphrase);
  inner.sign(kp);
  const bump = TransactionBuilder.buildFeeBumpTransaction(kp, BASE_FEE, inner, env.networkPassphrase);
  bump.sign(kp);
  return bump;
}

export async function sendSigned(tx: Transaction | FeeBumpTransaction): Promise<SubmitResult> {
  const server = rpcServer();
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    const reason = sent.errorResult?.result().switch().name ?? "unknown";
    throw new ContractCallError(`Transaction rejected: ${reason}`, reason, null);
  }
  if (sent.status === "TRY_AGAIN_LATER") throw new ContractCallError("Network busy, try again", "TRY_AGAIN_LATER", null);
  const done = await waitForTx(sent.hash);
  return { hash: sent.hash, ledger: done.ledger, returnValue: done.returnValue, events: [] };
}

export interface InvokeOptions {
  /** Fee-paying source: a server role, or a raw keypair (scripts: investors). */
  source: Role | Keypair;
  /** Extra roles whose address auth entries must be signed (e.g. treasury at settlement). */
  authSigners?: Role[];
  /** Raw keypairs whose address auth entries must be signed (scripts: investors, seed). */
  authKeypairs?: Keypair[];
  /** Custom signer for smart-account (C…) auth entries. */
  signAuthEntries?: (entries: xdr.SorobanAuthorizationEntry[], latestLedger: number) => Promise<xdr.SorobanAuthorizationEntry[]>;
  contract?: string;
}

/** Signs address-credential auth entries for classic G-accounts we hold keys for. */
async function signClassicEntries(
  entries: xdr.SorobanAuthorizationEntry[],
  signers: Keypair[],
  validUntil: number,
): Promise<xdr.SorobanAuthorizationEntry[]> {
  const byPub = new Map(signers.map((k) => [k.publicKey(), k]));
  const out: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of entries) {
    const creds = entry.credentials();
    const kind = creds.switch().name;
    if (kind === "sorobanCredentialsSourceAccount") {
      out.push(entry);
      continue;
    }
    const addrCreds = kind === "sorobanCredentialsAddress" ? creds.address() : kind === "sorobanCredentialsAddressV2" ? creds.addressV2() : null;
    const addr = addrCreds ? addressToString(addrCreds.address()) : null;
    const kp = addr ? byPub.get(addr) : undefined;
    out.push(kp ? await authorizeEntry(entry, kp, validUntil, env.networkPassphrase) : entry);
  }
  return out;
}

function addressToString(a: xdr.ScAddress): string {
  return Address.fromScAddress(a).toString();
}

/**
 * Submits one host-function operation from `source`, signing any auth entries it can.
 * Simulates twice (recording, then enforcing with signed auth) for accurate resources.
 */
export async function submitOperation(op: xdr.Operation, opts: InvokeOptions): Promise<SubmitResult> {
  const server = rpcServer();
  const sourceKp = opts.source instanceof Keypair ? opts.source : keypair(opts.source);
  const signers = [...(opts.authSigners ?? []).map(keypair), ...(opts.authKeypairs ?? [])];
  return withSourceLock(sourceKp.publicKey(), async () => {
    const account = await server.getAccount(sourceKp.publicKey());
    const startSeq = account.sequenceNumber();
    const first = buildTx(account, op);
    const sim1 = await server.simulateTransaction(first);
    if (rpc.Api.isSimulationError(sim1)) throw decodeContractError(sim1.error);
    let auth = sim1.result?.auth ?? [];
    const needsSigning = auth.some((a) => a.credentials().switch().name !== "sorobanCredentialsSourceAccount");
    let finalSim = sim1;
    let txForAssembly = first;
    if (needsSigning) {
      const validUntil = sim1.latestLedger + 120;
      auth = await signClassicEntries(auth, signers, validUntil);
      if (opts.signAuthEntries) auth = await opts.signAuthEntries(auth, sim1.latestLedger);
      const hf = (op.body().invokeHostFunctionOp() as xdr.InvokeHostFunctionOp).hostFunction();
      const signedOp = Operation.invokeHostFunction({ func: hf, auth });
      // buildTx bumped `account`; rebuild from the original sequence.
      txForAssembly = buildTx(new Account(sourceKp.publicKey(), startSeq), signedOp);
      const sim2 = await server.simulateTransaction(txForAssembly);
      if (rpc.Api.isSimulationError(sim2)) throw decodeContractError(sim2.error);
      finalSim = sim2;
    }
    return sendSigned(assembleSigned(txForAssembly, finalSim, sourceKp));
  });
}

/**
 * Submits an operation whose auth entries are already signed (agent passkey actions):
 * one enforcing-mode simulation (runs the smart account's __check_auth), assemble, sign, send.
 */
export async function submitPresigned(op: xdr.Operation, source: Role): Promise<SubmitResult> {
  const server = rpcServer();
  const sourceKp = keypair(source);
  return withSourceLock(sourceKp.publicKey(), async () => {
    const account = await server.getAccount(sourceKp.publicKey());
    const tx = buildTx(account, op);
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw decodeContractError(sim.error);
    // assembleTransaction keeps the op's existing (signed) auth entries.
    return sendSigned(assembleSigned(tx, sim, sourceKp));
  });
}

export async function invoke<T = unknown>(
  name: ContractName,
  fn: string,
  args: Args,
  opts: InvokeOptions,
): Promise<{ hash: string; ledger: number; result: T }> {
  const id = opts.contract ?? (await contractId(name));
  const op = new Contract(id).call(fn, ...encodeArgs(name, fn, args));
  const r = await submitOperation(op, opts);
  return { hash: r.hash, ledger: r.ledger, result: decodeResult<T>(name, fn, r.returnValue) };
}

/** Shorthand for operator-signed pool/note calls (§9.3 invokeAsOperator). */
export function invokeAsOperator<T = unknown>(name: ContractName, fn: string, args: Args, extra: Role[] = []) {
  return invoke<T>(name, fn, args, { source: "operator", authSigners: extra });
}

export async function latestLedger(): Promise<number> {
  return (await rpcServer().getLatestLedger()).sequence;
}
