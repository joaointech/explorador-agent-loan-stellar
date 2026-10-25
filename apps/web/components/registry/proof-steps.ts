// The steps of "Verify proof in your browser", shared by the verifier UI
// (rendered at once) and proof-check.ts (loaded on click, with snarkjs and the
// Stellar SDK).

export type ProofCheckStep = "verifier" | "key" | "signals" | "proof" | "pairing";

export const PROOF_CHECK_STEPS: readonly { id: ProofCheckStep; label: string; description: string }[] = [
  { id: "verifier", label: "Load the verifier", description: "snarkjs, the Groth16 library explorador proves with." },
  { id: "key", label: "Fetch the verification key", description: "From /zk/verification_key.json, the key the note contract checks with." },
  { id: "signals", label: "Rebuild the public signals", description: "From this note's agent, commissions, escritura date, commitment and nullifier." },
  { id: "proof", label: "Match the on-chain proof", description: "Un-negate A from the bytes stored on Stellar and compare." },
  { id: "pairing", label: "Check the pairing equation", description: "e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ) on BN254." },
];

/** Served from apps/web/public/zk (spec §8.5): the key cpcv_note was deployed with. */
export const VERIFICATION_KEY_URL = "/zk/verification_key.json";
