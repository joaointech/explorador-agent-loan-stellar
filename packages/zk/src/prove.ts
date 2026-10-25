/// <reference path="./types.d.ts" />
// Server-side proving (§8.6): build inputs → sign → fullProve → verify → format.

import { readFile } from "node:fs/promises";
import * as snarkjs from "snarkjs";
import { formatProof, type SnarkjsProof, type SorobanProof } from "./format";
import { buildAttestation, publicSignalsArray, type Attestation, type AttestationKeys, type CpcvRecord } from "./witness";

export interface ZkArtifacts {
  wasmPath: string;
  zkeyPath: string;
  vkPath: string;
}

export interface ProvenAttestation extends Attestation {
  proof: SnarkjsProof;
  publicSignalsList: string[];
  soroban: SorobanProof;
}

let vkCache: { path: string; vk: unknown } | null = null;

export async function loadVk(vkPath: string) {
  if (vkCache?.path !== vkPath) vkCache = { path: vkPath, vk: JSON.parse(await readFile(vkPath, "utf8")) };
  return vkCache.vk;
}

/** fullProve only (no local verification). */
export async function generateProof(attestation: Attestation, artifacts: ZkArtifacts) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(attestation.input, artifacts.wasmPath, artifacts.zkeyPath);
  const expected = publicSignalsArray(attestation.publicSignals);
  if (publicSignals.length !== expected.length || publicSignals.some((s, i) => s !== expected[i])) {
    throw new Error("public signals from the prover do not match the attestation");
  }
  return { proof: proof as SnarkjsProof, publicSignals };
}

export async function verifyProof(vkPath: string, proof: SnarkjsProof, publicSignals: string[]): Promise<boolean> {
  return snarkjs.groth16.verify(await loadVk(vkPath), publicSignals, proof);
}

export async function proveAttestation(
  attestation: Attestation,
  artifacts: ZkArtifacts,
): Promise<ProvenAttestation> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(attestation.input, artifacts.wasmPath, artifacts.zkeyPath);
  const expected = publicSignalsArray(attestation.publicSignals);
  if (publicSignals.length !== expected.length || publicSignals.some((s, i) => s !== expected[i])) {
    throw new Error("public signals from the prover do not match the attestation");
  }
  const ok = await snarkjs.groth16.verify(await loadVk(artifacts.vkPath), publicSignals, proof);
  if (!ok) throw new Error("local Groth16 verification failed");
  return { ...attestation, proof, publicSignalsList: publicSignals, soroban: formatProof(proof) };
}

export async function attestAndProve(
  record: CpcvRecord,
  agentAddress: string,
  keys: AttestationKeys,
  artifacts: ZkArtifacts,
  opts: { salt?: bigint } = {},
): Promise<ProvenAttestation> {
  const att = await buildAttestation(record, agentAddress, keys, opts);
  return proveAttestation(att, artifacts);
}
