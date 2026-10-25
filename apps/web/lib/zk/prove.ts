// Server-side CPCV proving (§8.6). Circuit artifacts live in apps/web/zk (committed build outputs).
import path from "node:path";
import {
  attesterPublicKey,
  attestAndProve,
  buildAttestation,
  formatProof,
  generateProof as zkGenerateProof,
  nullifierSecretCommitment,
  verifyProof,
  toHex32,
  type CpcvRecord,
  type ProvenAttestation,
  type ZkArtifacts,
} from "@advance/zk";
import { env } from "@/lib/env";
import { webRoot } from "@/lib/stellar/contracts";

export function zkArtifacts(): ZkArtifacts {
  const dir = path.join(webRoot(), "zk");
  return {
    wasmPath: path.join(dir, "cpcv_attestation.wasm"),
    zkeyPath: path.join(dir, "cpcv_attestation_final.zkey"),
    vkPath: path.join(dir, "verification_key.json"),
  };
}

export function attestationKeys() {
  return { attesterPrivHex: env.attesterPrivKey, nullifierSecret: env.nullifierSecret };
}

/** Values the cpcv_note constructor needs (attester_ax, attester_ay, nullifier_secret_commitment) as hex. */
export async function attesterConstructorValues() {
  const pub = await attesterPublicKey(env.attesterPrivKey);
  const nsc = await nullifierSecretCommitment(env.nullifierSecret);
  return { ax: toHex32(pub.ax), ay: toHex32(pub.ay), nsc: toHex32(nsc) };
}

export async function proveCpcv(record: CpcvRecord, agentAddress: string): Promise<ProvenAttestation> {
  return attestAndProve(record, agentAddress, attestationKeys(), zkArtifacts());
}

/** Split API used by the admin pipeline so each step can be reported separately. */
export async function signAttestation(record: CpcvRecord, agentAddress: string) {
  return buildAttestation(record, agentAddress, attestationKeys());
}

export async function generateProof(att: Awaited<ReturnType<typeof signAttestation>>) {
  return zkGenerateProof(att, zkArtifacts());
}

export async function verifyLocally(proof: Awaited<ReturnType<typeof generateProof>>) {
  const ok = await verifyProof(zkArtifacts().vkPath, proof.proof, proof.publicSignals);
  if (!ok) throw new Error("Local Groth16 verification failed");
  return formatProof(proof.proof);
}
