// The trust model (spec §8.1), worded once for the landing page, the registry
// and the note detail page.

/** What a verified proof shows publicly, without revealing personal data. */
export const PROOF_SHOWS = [
  "explorador's attester key signed this exact deal record.",
  "The commission was computed from a hidden sale price at a rate between 1% and 10%.",
  "The agent gets exactly half of it.",
  "The escritura date is after the CPCV date.",
  "The record is bound to this agent's account, so the note can only go to them.",
  "The deal has a unique nullifier, so the same CPCV can never be financed twice.",
] as const;

/** What stays private: encrypted in explorador's database, never on-chain. */
export const HIDDEN_FIELDS = [
  "Buyer name",
  "Buyer NIF",
  "Seller name",
  "Seller NIF",
  "Sale price",
  "Commission rate",
  "Property address",
  "CPCV date",
] as const;

/** The same list, grouped for compact lists. */
export const HIDDEN_SUMMARY = ["Buyer and seller", "Their NIFs (tax numbers)", "Sale price", "Commission rate", "Property address", "CPCV date"] as const;

/** What every CPCV Note publishes on Stellar. */
export const PUBLIC_FIELDS = [
  "The agent's smart-account address (never their name)",
  "Total commission and the agent's half",
  "Credit limit and escritura date",
  "Status: active, settled, cancelled or written off",
  "Commitment, nullifier and the Groth16 proof",
] as const;

export const ATTESTER_NOTE =
  "explorador is the attester: it signs that a real CPCV exists with these terms. The proof does not remove that trust; it makes the claim checkable without exposing anyone.";

export const AUDIT_NOTE =
  "The commitment lets explorador open a record to an auditor later without changing anything on-chain.";
