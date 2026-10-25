// Final transaction envelopes for Soroban operations whose resource fee may not
// fit the uint32 transaction fee (~429 XLM). When testnet fees spike, some
// operations cost thousands of XLM (WASM uploads, contract code TTL extensions that a
// contract call triggers when its code drops below the extension threshold), so
// such transactions are wrapped in a fee bump, whose fee is an int64: the inner
// transaction is built with a placeholder resource fee (the SDK builder caps
// the total at uint32), the simulated Soroban data is swapped in, and both
// envelopes are signed by the source. Same recipe as `sponsorEnvelope` in
// agent-tx-sponsor.ts, for any source key.

import { Account, FeeBumpTransaction, Transaction, TransactionBuilder, xdr, type Keypair } from "@stellar/stellar-sdk";

const UINT32_MAX = 0xffff_ffffn;
const PLACEHOLDER_RESOURCE_FEE = 1_000_000n;

/** True when `inclusionFee + resourceFee` fits a plain transaction's uint32 fee. */
export const feeFitsUint32 = (data: xdr.SorobanTransactionData, inclusionFee: bigint): boolean => data.resourceFee + inclusionFee <= UINT32_MAX;

/**
 * Signs `op` as `source` (sequence = the account's current sequence number)
 * with the simulated Soroban data: a plain transaction when the fee fits a
 * uint32, otherwise a fee bump paid by the same source.
 */
export function signedSorobanEnvelope(input: {
  source: Keypair;
  sequence: string;
  op: xdr.Operation;
  data: xdr.SorobanTransactionData;
  inclusionFee: bigint;
  networkPassphrase: string;
  timeoutSecs: number;
}): Transaction | FeeBumpTransaction {
  const { source, data, inclusionFee, networkPassphrase } = input;
  const fits = feeFitsUint32(data, inclusionFee);
  const built = new TransactionBuilder(new Account(source.publicKey(), input.sequence), { fee: inclusionFee.toString(), networkPassphrase })
    .setSorobanData(fits ? data : new xdr.SorobanTransactionData({ ext: data.ext, resources: data.resources, resourceFee: PLACEHOLDER_RESOURCE_FEE }))
    .addOperation(input.op)
    .setTimeout(input.timeoutSecs)
    .build();
  if (fits) {
    built.sign(source);
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
    networkPassphrase,
  );
  inner.sign(source);
  const bump = TransactionBuilder.buildFeeBumpTransaction(source, inclusionFee.toString(), inner, networkPassphrase);
  bump.sign(source);
  return bump;
}

/**
 * True when a failed transaction ran out of the resources its simulation
 * declared (`invokeHostFunctionResourceLimitExceeded`): the state changed between
 * simulation and execution (e.g. another transaction grew the same entry), so a
 * fresh simulation and resubmission usually succeeds.
 */
export function resourceLimitExceeded(result: xdr.TransactionResult | undefined): boolean {
  let outcome: xdr.TransactionResultResult | xdr.InnerTransactionResultResult | undefined = result?.result;
  if (outcome?.type === "txFeeBumpInnerFailed") outcome = outcome.innerResultPair.result.result;
  if (outcome?.type !== "txFailed") return false;
  const op = outcome.results[0];
  if (op?.type !== "opInner" || op.tr.type !== "invokeHostFunction") return false;
  return op.tr.invokeHostFunctionResult.type === "invokeHostFunctionResourceLimitExceeded";
}
