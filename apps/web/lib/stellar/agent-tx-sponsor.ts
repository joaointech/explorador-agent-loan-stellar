// Sponsored Soroban transactions (spec §3 `sponsor`, §9.3): the sponsor account
// is the transaction source and fee payer for every agent smart-account
// transaction, so agents never hold XLM or see a fee. The sponsor only signs the
// envelope; it must never appear as an authorizer inside an invocation.

import {
  Account,
  Address,
  Asset,
  Keypair,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
} from "@stellar/stellar-sdk";

import { env, requireEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

const INCLUSION_FEE = "1000"; // stroops; resource fees are added from simulation
const TX_TIMEOUT_SECS = 90;
const POLL_ATTEMPTS = 40; // ~1 s apart: ledgers close every ~5 s
const UINT32_MAX = 0xffffffffn;
/** Resource fee the SDK builder accepts; replaced by the simulated one on the fee-bump path. */
const PLACEHOLDER_RESOURCE_FEE = 1_000_000n;

/** Chain-side failure surfaced to API callers as `{ error: { code, message } }`. */
export class ChainTxError extends HttpError {
  constructor(
    code: string,
    message: string,
    public readonly txHash: string | null = null,
    status = 422,
  ) {
    super(status, code, message);
  }
}

let cachedServer: rpc.Server | undefined;

export function stellarRpc(): rpc.Server {
  cachedServer ??= new rpc.Server(env().STELLAR_RPC_URL, { allowHttp: env().STELLAR_RPC_URL.startsWith("http://") });
  return cachedServer;
}

export function networkPassphrase(): string {
  return env().STELLAR_NETWORK_PASSPHRASE;
}

export function sponsorKeypair(): Keypair {
  return Keypair.fromSecret(requireEnv("SPONSOR_SECRET"));
}

// ---------- serialization ----------

// One sponsored transaction at a time per process: the network accepts a single
// pending transaction per source account, and a bad-sequence error (another
// process won the race) is retried with a fresh sequence number below.
let sponsorQueue: Promise<unknown> = Promise.resolve();

export function withSponsorLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sponsorQueue.then(fn, fn);
  sponsorQueue = run.catch(() => undefined);
  return run;
}

// ---------- error decoding ----------

const SMART_ACCOUNT_ERRORS: Record<number, string> = {
  3000: "ContextRuleNotFound",
  3002: "UnvalidatedContext",
  3003: "ExternalVerificationFailed",
  3004: "NoSignersAndPolicies",
  3005: "PastValidUntil",
  3006: "SignerNotFound",
  3007: "DuplicateSigner",
  3008: "PolicyNotFound",
  3009: "DuplicatePolicy",
  3010: "TooManySigners",
  3011: "TooManyPolicies",
  3012: "MathOverflow",
  3013: "KeyDataTooLarge",
  3014: "ContextRuleIdsLengthMismatch",
  3015: "NameTooLong",
  3016: "UnauthorizedSigner",
  3110: "WebAuthnSignaturePayloadInvalid",
  3111: "WebAuthnClientDataTooLong",
  3112: "WebAuthnJsonParseError",
  3113: "WebAuthnTypeFieldInvalid",
  3114: "WebAuthnChallengeInvalid",
  3115: "WebAuthnAuthDataFormatInvalid",
  3116: "WebAuthnPresentBitNotSet",
  3117: "WebAuthnVerifiedBitNotSet",
  3118: "WebAuthnBackupEligibilityAndStateNotSet",
  3119: "WebAuthnKeyDataInvalid",
};

// contracts/shared/src/errors.rs (advance_pool, cpcv_note, teurc)
const ADVANCE_ERRORS: Record<number, string> = {
  1: "NotAuthorized",
  2: "AlreadyInitialized",
  3: "InvalidAmount",
  4: "InsufficientCredit",
  5: "InsufficientLiquidity",
  6: "LeverageCapExceeded",
  7: "CardNotEnabled",
  8: "AgentBlocked",
  9: "LineNotActive",
  10: "GraceNotOver",
  11: "NothingToWriteOff",
  12: "DuplicateDraw",
  13: "InvalidProof",
  14: "NullifierUsed",
  15: "CommitmentUsed",
  16: "EscrituraInPast",
  17: "Soulbound",
  18: "UnknownNote",
  19: "DemoModeDisabled",
  20: "ClockAdvanceTooLarge",
  21: "Overflow",
  22: "PoolNotSet",
};

/**
 * Turns a host error text into a short readable reason, e.g. `UnauthorizedSigner (#3016)`.
 * `advanceCodes` labels small codes with the explorador advance contract errors; only pass it
 * when the invoked contract is one of ours (other contracts reuse the same small numbers).
 */
export function describeHostError(text: string, opts: { advanceCodes?: boolean } = {}): string {
  const match = /Error\(Contract, #(\d+)\)/.exec(text);
  if (match) {
    const code = Number(match[1]);
    const name = SMART_ACCOUNT_ERRORS[code] ?? (opts.advanceCodes ? ADVANCE_ERRORS[code] : undefined);
    return name ? `${name} (#${code})` : `contract error #${code}`;
  }
  const auth = /Error\(Auth, (\w+)\)/.exec(text);
  if (auth) return `authorization failed (${auth[1]})`;
  const budget = /Error\(Budget, (\w+)\)/.exec(text);
  if (budget) return `resource limit exceeded (${budget[1]})`;
  const first = text.split("\n").find((line) => line.trim() !== "") ?? text;
  return first.length > 240 ? `${first.slice(0, 240)}…` : first;
}

/** First `Error(…)` found in diagnostic event topics, rendered like the host's error text. */
export function errorFromDiagnostics(events: xdr.DiagnosticEvent[] | undefined): string | null {
  for (const event of events ?? []) {
    for (const topic of event.event.body.v0.topics) {
      if (topic.type !== "scvError") continue;
      const err = topic.error;
      if (err.type === "sceContract") return `Error(Contract, #${err.contractCode})`;
      return `Error(${err.type.replace(/^sce/, "")}, ${err.code.name.replace(/^scec/, "")})`;
    }
  }
  return null;
}

function simulationFailed(error: string, opts: { advanceCodes?: boolean }): ChainTxError {
  return new ChainTxError("SIMULATION_FAILED", `Simulation failed: ${describeHostError(error, opts)}`);
}

// ---------- building blocks ----------

export function invokeTx(source: Account, func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[]): Transaction {
  return new TransactionBuilder(source, { fee: INCLUSION_FEE, networkPassphrase: networkPassphrase() })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(TX_TIMEOUT_SECS)
    .build();
}

/** `InvokeContract(contract, fn, args)` host function. */
export function invokeContractFunc(contract: string, fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args }),
  );
}

/** Stellar Asset Contract id of native XLM on this network. */
export function nativeAssetContractId(): string {
  return Asset.native().contractId(networkPassphrase());
}

/** SEP-41 `transfer(from, to, amount)` host function. */
export function tokenTransferFunc(token: string, from: string, to: string, amount: bigint): xdr.HostFunction {
  return invokeContractFunc(token, "transfer", [
    new Address(from).toScVal(),
    new Address(to).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

/** SEP-41 `balance(id)` via simulation. */
export async function readTokenBalance(token: string, id: string): Promise<bigint> {
  const res = await recordAuth(invokeContractFunc(token, "balance", [new Address(id).toScVal()]));
  if (!res.retval) throw new ChainTxError("SIMULATION_FAILED", "balance() returned no value");
  return BigInt(scValToNative(res.retval) as bigint | number);
}

/** Contract id derived from (deployer, salt) on this network (same rule the host applies). */
export function deriveContractId(deployer: string, salt: Uint8Array): string {
  if (salt.length !== 32) throw new Error("Contract salt must be 32 bytes");
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(new TextEncoder().encode(networkPassphrase())),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({ address: new Address(deployer).toScAddress(), salt: new Uint8Array(salt) }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

/** True when a contract instance exists at `contractId` (it may still be archived; simulation restores it). */
export async function contractExists(contractId: string): Promise<boolean> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
  const res = await stellarRpc().getLedgerEntries(key);
  return res.entries.length > 0;
}

/**
 * Builds the sponsor-sourced transaction for `op` with the simulated Soroban data and signs it as
 * sponsor. When the resource fee doesn't fit the uint32 transaction fee (~429 XLM; restoring archived
 * contract code costs more on today's testnet), the transaction is wrapped in a fee bump, whose
 * int64 fee pays for it: the inner transaction is built with a placeholder resource fee (the SDK
 * builder caps the total at uint32) and the simulated data is swapped in before signing.
 */
export function sponsorEnvelope(source: Account, op: xdr.Operation, data: xdr.SorobanTransactionData): Transaction | FeeBumpTransaction {
  const sponsor = sponsorKeypair();
  const passphrase = networkPassphrase();
  const fits = data.resourceFee + BigInt(INCLUSION_FEE) <= UINT32_MAX;
  const built = new TransactionBuilder(source, { fee: INCLUSION_FEE, networkPassphrase: passphrase })
    .setSorobanData(
      fits ? data : new xdr.SorobanTransactionData({ ext: data.ext, resources: data.resources, resourceFee: PLACEHOLDER_RESOURCE_FEE }),
    )
    .addOperation(op)
    .setTimeout(TX_TIMEOUT_SECS)
    .build();
  if (fits) {
    built.sign(sponsor);
    return built;
  }
  const envelope = built.toEnvelope();
  if (envelope.type !== "envelopeTypeTx") throw new Error("Unexpected transaction envelope type");
  const t = envelope.v1.tx;
  const inner = new Transaction(
    xdr.TransactionEnvelope.envelopeTypeTx(
      new xdr.TransactionV1Envelope({
        tx: new xdr.Transaction({
          sourceAccount: t.sourceAccount,
          fee: t.fee,
          seqNum: t.seqNum,
          cond: t.cond,
          memo: t.memo,
          operations: t.operations,
          ext: xdr.TransactionExt.sorobanData(data),
        }),
        signatures: [],
      }),
    ),
    passphrase,
  );
  inner.sign(sponsor);
  const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, INCLUSION_FEE, inner, passphrase);
  bump.sign(sponsor);
  return bump;
}

/** The source account as it was before `tx` consumed a sequence number (to rebuild the same transaction). */
const sourceOf = (tx: Transaction) => new Account(tx.source, (BigInt(tx.sequence) - 1n).toString());

async function sendAndPoll(tx: Transaction | FeeBumpTransaction, opts: { advanceCodes?: boolean }) {
  const server = stellarRpc();
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    const code: string = sent.errorResult?.result.type ?? "txFAILED";
    return { kind: "rejected" as const, code, hash: sent.hash };
  }
  if (sent.status === "TRY_AGAIN_LATER") return { kind: "busy" as const, hash: sent.hash };
  const final = await server.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
  if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return { kind: "success" as const, hash: sent.hash, ledger: final.ledger, returnValue: final.returnValue };
  }
  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    const hostError = errorFromDiagnostics(final.diagnosticEventsXdr);
    const reason = hostError ? describeHostError(hostError, opts) : final.resultXdr.result.type;
    throw new ChainTxError("TX_FAILED", `Transaction failed on-chain: ${reason}`, sent.hash);
  }
  throw new ChainTxError("TX_TIMEOUT", "Transaction was not confirmed in time", sent.hash, 504);
}

/** Restores archived ledger entries reported by a simulation (sponsor pays). */
async function restoreFootprint(source: Account, restore: rpc.Api.SimulateTransactionRestoreResponse["restorePreamble"]) {
  const tx = sponsorEnvelope(source, Operation.restoreFootprint({}), restore.transactionData.build());
  const res = await sendAndPoll(tx, {});
  if (res.kind !== "success") throw new ChainTxError("RESTORE_FAILED", `Could not restore archived contract state (${res.kind})`);
}

// ---------- public API ----------

export interface RecordedInvocation {
  /** Authorization entries the invocation needs (simulation in record mode). */
  auth: xdr.SorobanAuthorizationEntry[];
  latestLedger: number;
  retval: xdr.ScVal | undefined;
}

/** Simulates `func` with the sponsor as source in record mode, returning the auth entries to sign. */
export async function recordAuth(func: xdr.HostFunction, opts: { advanceCodes?: boolean } = {}): Promise<RecordedInvocation> {
  const server = stellarRpc();
  const sponsor = sponsorKeypair();
  for (let attempt = 0; attempt < 2; attempt++) {
    const source = await server.getAccount(sponsor.publicKey());
    const sim = await server.simulateTransaction(invokeTx(source, func, []), undefined, "record");
    if (rpc.Api.isSimulationError(sim)) throw simulationFailed(sim.error, opts);
    if (rpc.Api.isSimulationRestore(sim)) {
      await withSponsorLock(async () => restoreFootprint(await server.getAccount(sponsor.publicKey()), sim.restorePreamble));
      continue;
    }
    return { auth: sim.result?.auth ?? [], latestLedger: sim.latestLedger, retval: sim.result?.retval };
  }
  throw new ChainTxError("SIMULATION_FAILED", "Simulation kept asking for a state restore");
}

export interface SubmittedTx {
  txHash: string;
  ledger: number;
  returnValue: xdr.ScVal | undefined;
}

/**
 * Re-simulates `func` with the given (already signed) auth entries in enforce mode, assembles the
 * footprint and resource fee, signs as sponsor, submits and waits for the result. With no auth
 * entries, auth is recorded and only source-account authorization (the sponsor deploying) is allowed.
 */
export async function submitSponsored(
  func: xdr.HostFunction,
  signedAuth: xdr.SorobanAuthorizationEntry[],
  opts: { advanceCodes?: boolean } = {},
): Promise<SubmittedTx> {
  const server = stellarRpc();
  const sponsor = sponsorKeypair();
  return withSponsorLock(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const source = await server.getAccount(sponsor.publicKey());
      const tx = invokeTx(source, func, signedAuth);
      const sim = await server.simulateTransaction(tx, undefined, signedAuth.length > 0 ? "enforce" : undefined);
      if (rpc.Api.isSimulationError(sim)) throw simulationFailed(sim.error, opts);
      if (rpc.Api.isSimulationRestore(sim)) {
        await restoreFootprint(source, sim.restorePreamble);
        continue;
      }
      assertSponsorOnlyPaysFees(sim, signedAuth.length > 0);
      // Same as rpc.assembleTransaction (simulated footprint, resources and fee; recorded auth when
      // the caller sent none), plus the fee-bump fallback for resource fees above uint32.
      const auth = signedAuth.length > 0 ? signedAuth : (sim.result?.auth ?? []);
      const prepared = sponsorEnvelope(sourceOf(tx), Operation.invokeHostFunction({ func, auth }), sim.transactionData.build());
      const res = await sendAndPoll(prepared, opts);
      if (res.kind === "success") return { txHash: res.hash, ledger: res.ledger, returnValue: res.returnValue };
      if (res.kind === "busy" || res.code === "txBadSeq") {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new ChainTxError("TX_REJECTED", `Transaction rejected (${res.code})`, res.hash);
    }
    throw new ChainTxError("TX_REJECTED", "Sponsor account is busy; try again", null, 503);
  });
}

/**
 * Guard: when the caller supplied signed auth, simulation must not ask the sponsor for any
 * authorization. Without caller auth (deployments), only source-account credentials are allowed.
 */
function assertSponsorOnlyPaysFees(sim: rpc.Api.SimulateTransactionSuccessResponse, callerAuth: boolean) {
  if (callerAuth) return; // enforce mode: the provided entries are used verbatim
  for (const entry of sim.result?.auth ?? []) {
    if (entry.credentials.type !== "sorobanCredentialsSourceAccount") {
      throw new ChainTxError("UNEXPECTED_AUTH", "Invocation requires authorization from an address the server does not sign for");
    }
  }
}
