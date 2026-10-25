// Reads a CPCV Note straight from the cpcv_note contract over Soroban RPC, for
// "Verify proof in your browser": read-only simulations of `get(id)`,
// `attester_params()` and `verification_key()` (no account, no fee, nothing
// signed), so the check doesn't have to trust the registry API's copy.
// Loaded lazily with the verifier.

import { Account, BASE_FEE, Contract, TransactionBuilder, nativeToScVal, rpc, scValToNative, type xdr } from "@stellar/stellar-sdk";

import type { DeploymentInfo } from "@/lib/types/api";
import { toHex } from "@/lib/zk/field";
import type { SorobanProofHex, SorobanVerificationKeyHex } from "@/lib/zk/format";

import { ChainRejectedError, ChainUnavailableError } from "./chain-errors";

/** stellar-sdk's placeholder source account for read-only simulations. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** The note fields its proof binds, as stored on-chain (amounts in stroops, bytes as hex). */
export interface ChainNote {
  id: number;
  agent: string;
  totalCommission: bigint;
  agentCommission: bigint;
  escrituraDay: number;
  commitment: string;
  nullifier: string;
  /** A negated, as stored. */
  proof: SorobanProofHex;
}

/** `attester_params()`: public inputs 6–8, fixed at deploy. */
export interface ChainAttester {
  attesterAx: string;
  attesterAy: string;
  nullifierSecretCommitment: string;
}

export interface ChainSnapshot {
  contractId: string;
  note: ChainNote;
  attester: ChainAttester;
  vk: SorobanVerificationKeyHex;
}

/** Simulates a read-only call on the note contract and returns its value. */
export type ViewCall = (method: string, args?: xdr.ScVal[]) => Promise<xdr.ScVal>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function rpcView(deployment: Pick<DeploymentInfo, "rpcUrl" | "networkPassphrase" | "cpcvNote">): ViewCall {
  const server = new rpc.Server(deployment.rpcUrl, { allowHttp: deployment.rpcUrl.startsWith("http://") });
  const contract = new Contract(deployment.cpcvNote);
  return async (method, args = []) => {
    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: deployment.networkPassphrase })
      .addOperation(contract.call(method, ...args))
      .setTimeout(0)
      .build();
    let sim: rpc.Api.SimulateTransactionResponse;
    try {
      sim = await server.simulateTransaction(tx);
    } catch (err) {
      throw new ChainUnavailableError(`Soroban RPC didn't answer: ${message(err)}`);
    }
    if (rpc.Api.isSimulationError(sim)) throw new ChainRejectedError(`cpcv_note.${method} failed on Stellar: ${sim.error.split("\n")[0]}`);
    if (!sim.result) throw new ChainRejectedError(`cpcv_note.${method} returned nothing`);
    return sim.result.retval;
  };
}

type Native = Record<string, unknown>;

function struct(v: unknown, what: string): Native {
  if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Uint8Array) throw new ChainRejectedError(`${what} is not a struct`);
  return v as Native;
}

function bytes(v: unknown, length: number, what: string): string {
  if (!(v instanceof Uint8Array) || v.length !== length) throw new ChainRejectedError(`${what} is not ${length} bytes`);
  return toHex(v);
}

function int(v: unknown, what: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  throw new ChainRejectedError(`${what} is not an integer`);
}

export function decodeNote(value: xdr.ScVal): ChainNote {
  const n = struct(scValToNative(value), "note");
  const proof = struct(n.proof, "note.proof");
  if (typeof n.agent !== "string") throw new ChainRejectedError("note.agent is not an address");
  return {
    id: Number(int(n.id, "note.id")),
    agent: n.agent,
    totalCommission: int(n.total_commission, "note.total_commission"),
    agentCommission: int(n.agent_commission, "note.agent_commission"),
    escrituraDay: Number(int(n.escritura_day, "note.escritura_day")),
    commitment: bytes(n.commitment, 32, "note.commitment"),
    nullifier: bytes(n.nullifier, 32, "note.nullifier"),
    proof: { a: bytes(proof.a, 64, "proof.a"), b: bytes(proof.b, 128, "proof.b"), c: bytes(proof.c, 64, "proof.c") },
  };
}

export function decodeAttester(value: xdr.ScVal): ChainAttester {
  const p = struct(scValToNative(value), "attester_params");
  return {
    attesterAx: bytes(p.attester_ax, 32, "attester_ax"),
    attesterAy: bytes(p.attester_ay, 32, "attester_ay"),
    nullifierSecretCommitment: bytes(p.nullifier_secret_commitment, 32, "nullifier_secret_commitment"),
  };
}

export function decodeVerificationKey(value: xdr.ScVal): SorobanVerificationKeyHex {
  const k = struct(scValToNative(value), "verification_key");
  if (!Array.isArray(k.ic)) throw new ChainRejectedError("verification_key.ic is not a list");
  return {
    alpha: bytes(k.alpha, 64, "vk.alpha"),
    beta: bytes(k.beta, 128, "vk.beta"),
    gamma: bytes(k.gamma, 128, "vk.gamma"),
    delta: bytes(k.delta, 128, "vk.delta"),
    ic: k.ic.map((p, i) => bytes(p, 64, `vk.ic[${i}]`)),
  };
}

/** Note `id`, the attester parameters and the verification key, as the contract holds them. */
export async function readChainSnapshot(view: ViewCall, id: number, contractId: string): Promise<ChainSnapshot> {
  const [note, attester, vk] = await Promise.all([
    view("get", [nativeToScVal(id, { type: "u32" })]),
    view("attester_params"),
    view("verification_key"),
  ]);
  return { contractId, note: decodeNote(note), attester: decodeAttester(attester), vk: decodeVerificationKey(vk) };
}
