//! Groth16 verification over BN254 using Soroban's native host functions
//! (CAP-0074, Protocol 25+).
//!
//! Encodings (§8.5):
//! - G1: 64 bytes `be(x) ‖ be(y)`.
//! - G2: 128 bytes `be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0)` (Ethereum order).
//! - `proof.a` is already negated by the prover-side formatter, so the check is
//!   `e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1`.

use crate::types::{Groth16Proof, VerificationKey};
use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec, U256,
};

/// BN254 scalar field modulus r, big-endian.
pub const FR_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// True if the 32-byte big-endian value is a canonical scalar-field element (< r).
pub fn is_canonical_fr(bytes: &BytesN<32>) -> bool {
    let b = bytes.to_array();
    for i in 0..32 {
        if b[i] < FR_MODULUS_BE[i] {
            return true;
        }
        if b[i] > FR_MODULUS_BE[i] {
            return false;
        }
    }
    false // equal to r
}

pub fn fr_from_bytes(e: &Env, bytes: &BytesN<32>) -> Bn254Fr {
    Bn254Fr::from_u256(U256::from_be_bytes(e, &bytes.clone().into()))
}

pub fn fr_from_u64(e: &Env, v: u64) -> Bn254Fr {
    Bn254Fr::from_u256(U256::from_u128(e, v as u128))
}

/// Verifies a Groth16 proof whose `a` is pre-negated. Returns false on any
/// mismatch in sizes or a failing pairing check. Off-curve points make the
/// host trap, which also aborts the transaction.
pub fn verify(e: &Env, vk: &VerificationKey, proof: &Groth16Proof, public_inputs: &Vec<Bn254Fr>) -> bool {
    if vk.ic.len() != public_inputs.len() + 1 {
        return false;
    }
    let bn = e.crypto().bn254();

    let neg_a = Bn254G1Affine::from_bytes(proof.a.clone());
    let c = Bn254G1Affine::from_bytes(proof.c.clone());
    if !bn.g1_is_on_curve(&neg_a) || !bn.g1_is_on_curve(&c) {
        return false;
    }

    let mut vk_x = Bn254G1Affine::from_bytes(vk.ic.get_unchecked(0));
    for i in 0..public_inputs.len() {
        let ic = Bn254G1Affine::from_bytes(vk.ic.get_unchecked(i + 1));
        let term = bn.g1_mul(&ic, &public_inputs.get_unchecked(i));
        vk_x = bn.g1_add(&vk_x, &term);
    }

    let g1: Vec<Bn254G1Affine> = vec![
        e,
        neg_a,
        Bn254G1Affine::from_bytes(vk.alpha.clone()),
        vk_x,
        c,
    ];
    let g2: Vec<Bn254G2Affine> = vec![
        e,
        Bn254G2Affine::from_bytes(proof.b.clone()),
        Bn254G2Affine::from_bytes(vk.beta.clone()),
        Bn254G2Affine::from_bytes(vk.gamma.clone()),
        Bn254G2Affine::from_bytes(vk.delta.clone()),
    ];
    bn.pairing_check(g1, g2)
}
