// Generic Soroban host-function transactions for the deploy flow (WASM upload,
// contract creation, wiring calls), signed by an arbitrary source key:
// simulate → restore archived entries if asked → sign Address-credential auth
// entries → re-simulate (enforcing) → submit → poll.
//
// When testnet fees spike a WASM upload costs thousands of XLM, far above the
// ~429 XLM uint32 transaction fee cap, so transactions whose resource fee
// doesn't fit are fee-bumped (lib/stellar/envelope.ts).

import {
  Account,
  FeeBumpTransaction,
  Operation,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  inspectAuthEntry,
  rpc,
  type Keypair,
  type xdr,
} from "@stellar/stellar-sdk";

import { networkConfig } from "@/lib/stellar/config";
import { signedSorobanEnvelope } from "@/lib/stellar/envelope";
import { MissingSignerError, parseHostError, TxError } from "@/lib/stellar/errors";
import { inProcessMutex } from "@/lib/stellar/lock";
import { getRpc, rpcCall, sleep } from "@/lib/stellar/rpc";

/** Inclusion fee in stroops; resource fees come from simulation. */
const INCLUSION_FEE = 10_000n;
const TX_TIMEOUT_SECS = 120;
/** Auth entry signatures stay valid this many ledgers (~8 min). */
const AUTH_VALID_LEDGERS = 100;
const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_MS = 90_000;

export interface HostFunctionParams {
  func: xdr.HostFunction;
  /** Transaction source and fee payer. */
  source: Keypair;
  /** Keys for Address-credential auth entries (the source signs its own entries implicitly). */
  signers?: Keypair[];
  /** Label for logs and errors (e.g. "upload advance_pool"). */
  label: string;
  /** Called with the total fee (stroops) before submitting, e.g. to top up the source. */
  beforeSubmit?: (feeStroops: bigint) => Promise<void>;
}

export interface HostFunctionResult {
  txHash: string;
  ledger: number;
  returnValue: xdr.ScVal | undefined;
  /** Fee actually charged, in stroops. */
  feeCharged: bigint;
  /** True when the transaction had to be wrapped in a fee bump. */
  feeBumped: boolean;
}

function baseTx(source: Account, op: xdr.Operation): Transaction {
  return new TransactionBuilder(source, { fee: INCLUSION_FEE.toString(), networkPassphrase: networkConfig().networkPassphrase })
    .addOperation(op)
    .setTimeout(TX_TIMEOUT_SECS)
    .build();
}

/** Builds the final envelope for `op` with the simulated Soroban data, fee-bumping when the fee doesn't fit a uint32. */
export function sorobanEnvelope(source: Keypair, sequence: string, op: xdr.Operation, data: xdr.SorobanTransactionData): Transaction | FeeBumpTransaction {
  return signedSorobanEnvelope({
    source,
    sequence,
    op,
    data,
    inclusionFee: INCLUSION_FEE,
    networkPassphrase: networkConfig().networkPassphrase,
    timeoutSecs: TX_TIMEOUT_SECS,
  });
}

async function simulate(tx: Transaction, label: string): Promise<rpc.Api.SimulateTransactionResponse> {
  const sim = await rpcCall(`simulate ${label}`, () => getRpc().simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw parseHostError(sim.error, label);
  return sim;
}

async function sendAndPoll(tx: Transaction | FeeBumpTransaction, label: string): Promise<{ hash: string; res: rpc.Api.GetSuccessfulTransactionResponse }> {
  const server = getRpc();
  let sent: rpc.Api.SendTransactionResponse | undefined;
  for (let i = 0; ; i++) {
    sent = await rpcCall(`send ${label}`, () => server.sendTransaction(tx));
    if (sent.status !== "TRY_AGAIN_LATER" || i >= 4) break;
    await sleep(1_500 * (i + 1));
  }
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    const code = sent.errorResult?.result.type ?? sent.status;
    throw new TxError("TX_REJECTED", `${label} was rejected by the network (${code})`, sent.hash ?? null, code);
  }
  const deadline = Date.now() + POLL_MAX_MS;
  for (;;) {
    let res: rpc.Api.GetTransactionResponse | undefined;
    try {
      res = await server.getTransaction(sent.hash);
    } catch {
      // transient: keep polling until the deadline
    }
    if (res?.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash: sent.hash, res };
    if (res?.status === rpc.Api.GetTransactionStatus.FAILED) {
      const code = res.resultXdr?.result.type;
      throw new TxError("TX_FAILED", `${label} failed on-chain (${code ?? "unknown"}), tx ${sent.hash}`, sent.hash, code);
    }
    if (Date.now() > deadline) throw new TxError("TX_TIMEOUT", `${label}: transaction ${sent.hash} not confirmed in time`, sent.hash);
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Restores archived ledger entries reported by a simulation (the source pays). */
async function restore(source: Keypair, preamble: rpc.Api.SimulateTransactionRestoreResponse["restorePreamble"], label: string) {
  const account = await rpcCall("getAccount", () => getRpc().getAccount(source.publicKey()));
  const tx = sorobanEnvelope(source, account.sequenceNumber(), Operation.restoreFootprint({}), preamble.transactionData.build());
  await sendAndPoll(tx, `restore for ${label}`);
}

const feeOf = (tx: Transaction | FeeBumpTransaction): bigint => BigInt(tx.fee);

/** Runs one host function as `source` (serialized per source in this process). */
export async function submitHostFunction(p: HostFunctionParams): Promise<HostFunctionResult> {
  return inProcessMutex(`demo-tx:${p.source.publicKey()}`, async () => {
    const { networkPassphrase } = networkConfig();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const account = await rpcCall("getAccount", () => getRpc().getAccount(p.source.publicKey()));
      const sequence = account.sequenceNumber();
      const fresh = () => new Account(p.source.publicKey(), sequence);

      let op = Operation.invokeHostFunction({ func: p.func, auth: [] });
      let sim = await simulate(baseTx(fresh(), op), p.label);
      if (rpc.Api.isSimulationRestore(sim)) {
        await restore(p.source, sim.restorePreamble, p.label);
        continue;
      }
      let success = sim as rpc.Api.SimulateTransactionSuccessResponse;
      const entries = success.result?.auth ?? [];
      if (entries.some((e) => e.credentials.type !== "sorobanCredentialsSourceAccount")) {
        const signers = new Map([p.source, ...(p.signers ?? [])].map((k) => [k.publicKey(), k]));
        const validUntil = success.latestLedger + AUTH_VALID_LEDGERS;
        const signed = await Promise.all(
          entries.map(async (entry) => {
            if (entry.credentials.type === "sorobanCredentialsSourceAccount") return entry;
            const address = inspectAuthEntry(entry).address;
            const signer = address ? signers.get(address) : undefined;
            if (!signer || !address) throw new MissingSignerError(address ?? "unknown address", p.label);
            return authorizeEntry(entry, signer, validUntil, networkPassphrase);
          }),
        );
        op = Operation.invokeHostFunction({ func: p.func, auth: signed });
        sim = await simulate(baseTx(fresh(), op), p.label);
        if (rpc.Api.isSimulationRestore(sim)) {
          await restore(p.source, sim.restorePreamble, p.label);
          continue;
        }
        success = sim as rpc.Api.SimulateTransactionSuccessResponse;
      } else if (entries.length) {
        op = Operation.invokeHostFunction({ func: p.func, auth: entries });
      }

      const data = success.transactionData.build();
      if (p.beforeSubmit) await p.beforeSubmit(data.resourceFee + INCLUSION_FEE * 2n);
      const tx = sorobanEnvelope(p.source, sequence, op, data);
      try {
        const { hash, res } = await sendAndPoll(tx, p.label);
        return {
          txHash: hash,
          ledger: res.ledger,
          returnValue: res.returnValue,
          feeCharged: res.resultXdr ? BigInt(res.resultXdr.feeCharged.toString()) : feeOf(tx),
          feeBumped: tx instanceof FeeBumpTransaction,
        };
      } catch (err) {
        if (err instanceof TxError && err.resultCode === "txBadSeq" && attempt < 3) continue;
        throw err;
      }
    }
    throw new TxError("TX_REJECTED", `${p.label}: kept failing after restoring archived state`, null);
  });
}
