//! Groth16 verifier over BN254 using the Soroban host functions (spec §8.5).
//! Owned by the ZK workstream; this is the interface `cpcv_note` builds on.

use soroban_sdk::{BytesN, Env, Vec};

use crate::types::{Groth16Proof, VerificationKey};

/// Checks `e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1` where
/// `vk_x = ic[0] + Σ ic[i+1] · public_inputs[i]`.
/// `public_inputs` are BN254 scalar-field elements as 32-byte big-endian
/// values, in circuit order (spec §8.2).
pub fn verify(
    _env: &Env,
    _vk: &VerificationKey,
    _proof: &Groth16Proof,
    _public_inputs: &Vec<BytesN<32>>,
) -> bool {
    unimplemented!("implemented by the ZK workstream")
}
