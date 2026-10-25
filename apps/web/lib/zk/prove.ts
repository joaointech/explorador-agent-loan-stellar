/// <reference path="./vendor.d.ts" />
// Server-side Groth16 proving for CPCV attestations (spec §8.6). The admin
// CPCV pipeline calls proveCpcv. Works from Node route handlers (process.cwd()
// = apps/web) and tsx scripts; no `server-only`.

import { groth16 } from "snarkjs";

import { requireEnv } from "@/lib/env";
import type { SnarkjsProof } from "@/lib/types/api";

import { zkArtifacts, loadVerificationKey } from "./artifacts";
import { buildCpcvWitnessInput, type ZkKeys } from "./attestation";
import { fieldToBytes, fieldToHex } from "./field";
import { normalizeSnarkjsProof, proofToSoroban } from "./format";

export type { ZkKeys } from "./attestation";

export interface CpcvPrivateInput {
  buyerNif: string; // 9 digits
  sellerNif: string; // 9 digits
  salePriceCents: bigint;
  commissionRateBps: number; // 100…1000
  /** Raw address; normalized for property_hash per spec §8.4. */
  propertyAddress: string;
  cpcvDay: number;
  escrituraDay: number;
}

export type ProveStep = "signing" | "proving" | "verifying";

export interface CpcvProof {
  totalCommissionCents: bigint;
  agentCommissionCents: bigint;
  /** 32-byte big-endian field elements. */
  commitment: Uint8Array;
  nullifier: Uint8Array;
  /** The 9 public signals in circuit order (spec §8.2), decimal strings. */
  publicSignals: string[];
  /** Un-negated snarkjs proof. Stored in `Cpcv.proof` as `{ proof, publicSignals }`. */
  snarkjsProof: SnarkjsProof;
  /** Soroban-formatted bytes with A negated (spec §8.5): pass to `cpcv_note.mint`. */
  sorobanProof: { a: Uint8Array; b: Uint8Array; c: Uint8Array };
  /** Commitment salt (hex). Store it inside the encrypted PII so the commitment can be opened for an auditor. */
  salt: string;
}

/** `ATTESTER_EDDSA_PRIVKEY` and `NULLIFIER_SECRET` from the environment. */
export function zkKeysFromEnv(): ZkKeys {
  return {
    attesterPrivKey: requireEnv("ATTESTER_EDDSA_PRIVKEY"),
    nullifierSecret: requireEnv("NULLIFIER_SECRET"),
  };
}

/** Signs the attestation, generates the Groth16 proof and verifies it locally before returning. */
export async function proveCpcv(
  agentAddress: string,
  input: CpcvPrivateInput,
  onStep?: (step: ProveStep) => void,
): Promise<CpcvProof> {
  return proveCpcvWithKeys(agentAddress, input, zkKeysFromEnv(), onStep);
}

/** proveCpcv with explicit keys (scripts, fixtures, tests). `salt` is random unless given. */
export async function proveCpcvWithKeys(
  agentAddress: string,
  input: CpcvPrivateInput,
  keys: ZkKeys,
  onStep?: (step: ProveStep) => void,
  opts: { salt?: bigint } = {},
): Promise<CpcvProof> {
  onStep?.("signing");
  const witness = await buildCpcvWitnessInput(agentAddress, input, keys, opts);

  onStep?.("proving");
  const { wasm, zkey } = zkArtifacts();
  const { proof, publicSignals } = await groth16.fullProve(witness.circuitInput, wasm, zkey);
  if (publicSignals.length !== 9 || publicSignals.some((s, i) => s !== witness.publicSignals[i])) {
    throw new Error("Proof public signals do not match the attested values (stale circuit artifacts?)");
  }

  onStep?.("verifying");
  const snarkjsProof = normalizeSnarkjsProof(proof);
  if (!(await groth16.verify(loadVerificationKey(), publicSignals, snarkjsProof))) {
    throw new Error("Local Groth16 verification failed (verification key does not match the proving key?)");
  }

  return {
    totalCommissionCents: witness.totalCommissionCents,
    agentCommissionCents: witness.agentCommissionCents,
    commitment: fieldToBytes(witness.commitment),
    nullifier: fieldToBytes(witness.nullifier),
    publicSignals,
    snarkjsProof,
    sorobanProof: proofToSoroban(snarkjsProof),
    salt: fieldToHex(witness.salt),
  };
}

/**
 * Terminates snarkjs' cached worker threads. Long-running servers keep them
 * (faster proofs); tsx scripts and tests call this so the process can exit.
 */
export async function releaseZkResources(): Promise<void> {
  const curve = (globalThis as { curve_bn128?: { terminate(): Promise<void> } | null }).curve_bn128;
  if (curve) await curve.terminate();
}
