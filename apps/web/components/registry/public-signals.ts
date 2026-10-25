// The 9 public signals of the CPCV circuit (spec §8.2), labelled for the note
// detail page. Display only: no Stellar SDK here, so the page bundle stays
// small (the verifier loads lib/zk lazily).

import { formatCents, formatDate } from "@/lib/format";

export interface SignalDefinition {
  /** Circuit signal name. */
  name: string;
  label: string;
  meaning: string;
  kind: "field" | "cents" | "day";
}

export const PUBLIC_SIGNALS: readonly SignalDefinition[] = [
  { name: "agent_field", label: "Agent", meaning: "Hash of the agent's Stellar address: binds the proof to this account.", kind: "field" },
  { name: "total_commission_cents", label: "Total commission", meaning: "In euro cents.", kind: "cents" },
  { name: "agent_commission_cents", label: "Agent commission", meaning: "Exactly half of the total, rounded down.", kind: "cents" },
  { name: "escritura_day", label: "Escritura date", meaning: "Days since 1 Jan 1970 (UTC).", kind: "day" },
  { name: "commitment", label: "Commitment", meaning: "Poseidon hash of the hidden deal record, for audits.", kind: "field" },
  { name: "nullifier", label: "Nullifier", meaning: "Unique per CPCV: the same deal can't be financed twice.", kind: "field" },
  { name: "attester_ax", label: "Attester key (x)", meaning: "explorador's BabyJubJub public key that signed the deal.", kind: "field" },
  { name: "attester_ay", label: "Attester key (y)", meaning: "Second coordinate of the same key.", kind: "field" },
  { name: "nullifier_secret_commitment", label: "Nullifier secret commitment", meaning: "Poseidon of explorador's nullifier secret, fixed in the contract.", kind: "field" },
] as const;

export interface SignalRow extends SignalDefinition {
  index: number;
  /** Decimal, as snarkjs takes it. */
  value: string;
  /** Human reading: "€15,000.00", "23 Jan 2027", or the 32-byte hex. */
  reading: string;
}

/** 32-byte big-endian hex of a decimal field element (no 0x). */
export function signalHex(decimal: string): string {
  return BigInt(decimal).toString(16).padStart(64, "0");
}

function reading(kind: SignalDefinition["kind"], value: string): string {
  try {
    if (kind === "cents") return formatCents(BigInt(value));
    if (kind === "day") return formatDate(Number(value));
    return `0x${signalHex(value)}`;
  } catch {
    return value;
  }
}

/** Labelled rows for the signals the API returned (empty when it has none). */
export function describePublicSignals(signals: readonly string[]): SignalRow[] {
  if (signals.length !== PUBLIC_SIGNALS.length) return [];
  return PUBLIC_SIGNALS.map((def, index) => ({ ...def, index, value: signals[index], reading: reading(def.kind, signals[index]) }));
}
