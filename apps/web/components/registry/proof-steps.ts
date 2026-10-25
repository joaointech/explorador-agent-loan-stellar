// The steps of "Verify proof in your browser", shared by the verifier UI
// (rendered at once) and proof-check.ts (loaded on click, with snarkjs and the
// Stellar SDK).

export type ProofCheckStep = "verifier" | "key" | "chain" | "signals" | "proof" | "pairing";

export const PROOF_CHECK_STEPS: readonly { id: ProofCheckStep; label: string; description: string }[] = [
  { id: "verifier", label: "Load the verifier", description: "snarkjs, the Groth16 library explorador proves with." },
  { id: "key", label: "Fetch the verification key", description: "The published /zk/verification_key.json." },
  {
    id: "chain",
    label: "Read the note from Stellar",
    description: "The note, the attester key and the verification key, straight from the note contract over Soroban RPC.",
  },
  {
    id: "signals",
    label: "Rebuild the public signals",
    description: "From the note's agent, commissions, escritura date, commitment and nullifier, and the contract's attester key.",
  },
  { id: "proof", label: "Match the proof", description: "Un-negate A from the stored bytes and compare with the registry's copy." },
  { id: "pairing", label: "Check the pairing equation", description: "e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ) on BN254." },
];

/** Served from apps/web/public/zk (spec §8.5); the chain step checks it is the key cpcv_note holds. */
export const VERIFICATION_KEY_URL = "/zk/verification_key.json";
