// Rebuilds a note's 9 public signals from on-chain data (spec §8.5): what the
// registry API returns and what the browser feeds to `snarkjs.groth16.verify`.
// Browser-safe.

import { STROOPS_PER_CENT } from "@/lib/units";

import { agentFieldValue } from "./agent-field";
import { bigIntToBytes, fieldFromBytes, toHex } from "./field";

type Bytes32 = Uint8Array | string; // BytesN<32>, or its hex

/** The on-chain note fields the proof binds (amounts in stroops, as stored by cpcv_note). */
export interface NotePublicData {
  agent: string;
  totalCommission: bigint | string;
  agentCommission: bigint | string;
  escrituraDay: number;
  commitment: Bytes32;
  nullifier: Bytes32;
}

/** The cpcv_note constructor parameters the proof binds (contract views `attester_ax`, `attester_ay`, `nullifier_secret_commitment`). */
export interface AttesterParams {
  attesterAx: Bytes32;
  attesterAy: Bytes32;
  nullifierSecretCommitment: Bytes32;
}

function stroopsToExactCents(stroops: bigint | string, what: string): bigint {
  const v = BigInt(stroops);
  if (v < 0n || v % STROOPS_PER_CENT !== 0n) throw new Error(`${what} is not a whole number of cents`);
  return v / STROOPS_PER_CENT;
}

/** `[agent_field, total_commission_cents, agent_commission_cents, escritura_day, commitment, nullifier, attester_ax, attester_ay, nullifier_secret_commitment]` as decimal strings. */
export function buildPublicSignals(note: NotePublicData, params: AttesterParams): string[] {
  return [
    agentFieldValue(note.agent),
    stroopsToExactCents(note.totalCommission, "total commission"),
    stroopsToExactCents(note.agentCommission, "agent commission"),
    BigInt(note.escrituraDay),
    fieldFromBytes(note.commitment),
    fieldFromBytes(note.nullifier),
    fieldFromBytes(params.attesterAx),
    fieldFromBytes(params.attesterAy),
    fieldFromBytes(params.nullifierSecretCommitment),
  ].map(String);
}

/** For display: public signal (decimal) → 64-char hex. */
export const signalToHex = (signal: string): string => toHex(bigIntToBytes(BigInt(signal), 32));
