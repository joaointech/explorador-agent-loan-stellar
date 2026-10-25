/// <reference path="./vendor.d.ts" />
// Re-verifies an on-chain note with snarkjs (spec §8.5, registry "Verify proof
// in your browser"): un-negate A, rebuild the public signals, groth16.verify.
// Works in the browser (snarkjs' browser build) and in Node.

import { groth16 } from "snarkjs";

import type { SnarkjsProof } from "@/lib/types/api";

import { sorobanToProof, type SnarkjsVerificationKey, type SorobanProof, type SorobanProofHex } from "./format";
import { buildPublicSignals, type AttesterParams, type NotePublicData } from "./public-signals";

export interface NoteProofCheck {
  valid: boolean;
  publicSignals: string[];
  snarkjsProof: SnarkjsProof;
}

/** `vk` is `/zk/verification_key.json`; `proof` is the note's on-chain proof (A negated). */
export async function verifyNoteProof(
  note: NotePublicData & { proof: SorobanProof | SorobanProofHex },
  params: AttesterParams,
  vk: SnarkjsVerificationKey,
): Promise<NoteProofCheck> {
  const snarkjsProof = sorobanToProof(note.proof);
  const publicSignals = buildPublicSignals(note, params);
  const valid = await groth16.verify(vk, publicSignals, snarkjsProof);
  return { valid, publicSignals, snarkjsProof };
}
