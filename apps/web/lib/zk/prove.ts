// Interface owned by the ZK workstream (spec §8.6). The admin CPCV pipeline
// calls proveCpcv; the implementation replaces the stub body.

import { notImplemented } from "@/lib/http";
import type { SnarkjsProof } from "@/lib/types/api";

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

/** Signs the attestation, generates the Groth16 proof and verifies it locally before returning. */
export async function proveCpcv(
  _agentAddress: string,
  _input: CpcvPrivateInput,
  _onStep?: (step: ProveStep) => void,
): Promise<CpcvProof> {
  notImplemented("proveCpcv", "zk");
}
