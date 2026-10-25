// Read-only contract calls via RPC simulation (spec §9.3 `readContract`).

import { Account, BASE_FEE, Contract, TransactionBuilder, rpc, type xdr } from "@stellar/stellar-sdk";

import { networkConfig } from "./config";
import { requireDeployment } from "./deployment";
import { HostError, parseHostError } from "./errors";
import { getRpc, rpcCall, withTimeout } from "./rpc";

/** Simulation-only source account: it doesn't need to exist (the SDK contract client does the same). */
export const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Keys of the deployed contracts in `DeploymentInfo`. */
export type ContractKey = "teurc" | "cpcvNote" | "advancePool";

export interface ViewOptions {
  /** Total budget in ms, including the deployment lookup (the ASA handler uses 1200). */
  timeoutMs?: number;
}

/** Simulates `contractId.fn(args)` and returns the raw return value. */
export async function simulateView(contractId: string, fn: string, args: xdr.ScVal[], opts: ViewOptions = {}): Promise<xdr.ScVal> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
    fee: BASE_FEE,
    networkPassphrase: networkConfig().networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await rpcCall(`simulate ${fn}`, () => getRpc().simulateTransaction(tx), opts.timeoutMs);
  if (rpc.Api.isSimulationError(sim)) throw parseHostError(sim.error, fn, contractId);
  if (!sim.result) throw new HostError(fn, "simulation returned no result", "");
  return sim.result.retval;
}

/** Simulates a view on one of the deployed contracts and decodes the result. */
export async function readContract<T>(
  contract: ContractKey,
  fn: string,
  args: xdr.ScVal[],
  decode: (retval: xdr.ScVal) => T,
  opts: ViewOptions = {},
): Promise<T> {
  const run = async () => {
    const deployment = await requireDeployment();
    return decode(await simulateView(deployment.info[contract], fn, args));
  };
  return withTimeout(run(), opts.timeoutMs, `${contract}.${fn}`);
}
