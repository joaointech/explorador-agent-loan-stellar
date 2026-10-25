//! Groth16 verifier over BN254 using the Soroban host functions (spec §8.5,
//! CAP-0074: `bn254_g1_add`, `bn254_g1_mul`, `bn254_multi_pairing_check`).
//!
//! Encodings (soroban-sdk 28 `crypto::bn254`, Ethereum-compatible):
//! - G1 = 64 bytes `be(x) ‖ be(y)`.
//! - G2 = 128 bytes `be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0)` (each Fp2
//!   element imaginary part first; snarkjs JSON lists `[c0, c1]`, so
//!   `apps/web/lib/zk/format.ts` swaps the halves).
//! - The point at infinity is all zero bytes.
//!
//! Points are validated by the host when they reach a host function: an
//! off-curve G1/G2 point or a G2 point outside the subgroup traps (the call
//! fails) rather than returning `false`. A well-formed but wrong proof
//! returns `false`.

use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec,
};

use crate::types::{Groth16Proof, VerificationKey};

/// BN254 scalar-field modulus `r`, big-endian.
const FR_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// True if the big-endian `bytes` encode a canonical scalar-field element
/// (`< r`). Non-canonical encodings (`x + r`) are rejected so that one field
/// element has exactly one byte encoding: otherwise a nullifier or commitment
/// could be replayed under a second encoding past the contract's "used" checks.
pub fn is_canonical_fr(bytes: &BytesN<32>) -> bool {
    bytes.to_array() < FR_MODULUS_BE
}

/// Checks `e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1` where
/// `vk_x = ic[0] + Σ ic[i+1] · public_inputs[i]`.
/// `public_inputs` are BN254 scalar-field elements as 32-byte big-endian
/// values, in circuit order (spec §8.2). `proof.a` is already negated.
/// Returns `false` if the input count does not match the key, if an input is
/// not canonical (`≥ r`), or if the pairing check fails.
pub fn verify(
    env: &Env,
    vk: &VerificationKey,
    proof: &Groth16Proof,
    public_inputs: &Vec<BytesN<32>>,
) -> bool {
    if vk.ic.len() != public_inputs.len() + 1 {
        return false;
    }
    if !public_inputs.iter().all(|input| is_canonical_fr(&input)) {
        return false;
    }

    let bn254 = env.crypto().bn254();

    let mut vk_x = Bn254G1Affine::from_bytes(vk.ic.get_unchecked(0));
    for (i, input) in public_inputs.iter().enumerate() {
        let ic = Bn254G1Affine::from_bytes(vk.ic.get_unchecked(i as u32 + 1));
        let term = bn254.g1_mul(&ic, &Bn254Fr::from_bytes(input));
        vk_x = bn254.g1_add(&vk_x, &term);
    }

    let g1: Vec<Bn254G1Affine> = vec![
        env,
        Bn254G1Affine::from_bytes(proof.a.clone()),
        Bn254G1Affine::from_bytes(vk.alpha.clone()),
        vk_x,
        Bn254G1Affine::from_bytes(proof.c.clone()),
    ];
    let g2: Vec<Bn254G2Affine> = vec![
        env,
        Bn254G2Affine::from_bytes(proof.b.clone()),
        Bn254G2Affine::from_bytes(vk.beta.clone()),
        Bn254G2Affine::from_bytes(vk.gamma.clone()),
        Bn254G2Affine::from_bytes(vk.delta.clone()),
    ];
    bn254.pairing_check(g1, g2)
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::Env;

    #[allow(dead_code)]
    mod fixture {
        include!("../fixtures/groth16_fixture.rs");
    }
    use fixture::{FixtureNote, NOTES};

    fn vk(env: &Env) -> VerificationKey {
        let mut ic = Vec::new(env);
        for p in fixture::VK_IC.iter() {
            ic.push_back(BytesN::from_array(env, p));
        }
        VerificationKey {
            alpha: BytesN::from_array(env, &fixture::VK_ALPHA),
            beta: BytesN::from_array(env, &fixture::VK_BETA),
            gamma: BytesN::from_array(env, &fixture::VK_GAMMA),
            delta: BytesN::from_array(env, &fixture::VK_DELTA),
            ic,
        }
    }

    fn proof(env: &Env, note: &FixtureNote) -> Groth16Proof {
        Groth16Proof {
            a: BytesN::from_array(env, &note.a),
            b: BytesN::from_array(env, &note.b),
            c: BytesN::from_array(env, &note.c),
        }
    }

    fn inputs(env: &Env, note: &FixtureNote) -> Vec<BytesN<32>> {
        let mut v = Vec::new(env);
        for x in note.public_inputs.iter() {
            v.push_back(BytesN::from_array(env, x));
        }
        v
    }

    /// Big-endian add of a small value (no overflow in these tests).
    fn add_be(bytes: &[u8; 32], rhs: &[u8; 32]) -> [u8; 32] {
        let mut out = [0u8; 32];
        let mut carry = 0u16;
        for i in (0..32).rev() {
            let s = bytes[i] as u16 + rhs[i] as u16 + carry;
            out[i] = s as u8;
            carry = s >> 8;
        }
        assert_eq!(carry, 0);
        out
    }

    fn one() -> [u8; 32] {
        let mut b = [0u8; 32];
        b[31] = 1;
        b
    }

    /// Negates a G1 point (y → p − y) with the SDK's own implementation.
    fn neg_g1(p: &BytesN<64>) -> BytesN<64> {
        (-Bn254G1Affine::from_bytes(p.clone())).to_bytes()
    }

    #[test]
    fn verifies_the_snarkjs_fixture_proofs() {
        let env = Env::default();
        let vk = vk(&env);
        for note in NOTES.iter() {
            assert!(verify(&env, &vk, &proof(&env, note), &inputs(&env, note)));
        }
    }

    #[test]
    fn rejects_a_tampered_public_input() {
        let env = Env::default();
        let vk = vk(&env);
        let note = &NOTES[0];
        // Each public input, bumped by one, breaks the proof.
        for i in 0..9u32 {
            let mut tampered = inputs(&env, note);
            let bumped = add_be(&tampered.get_unchecked(i).to_array(), &one());
            tampered.set(i, BytesN::from_array(&env, &bumped));
            assert!(
                !verify(&env, &vk, &proof(&env, note), &tampered),
                "input {i}"
            );
        }
        // Another note's public inputs with this note's proof.
        assert!(!verify(
            &env,
            &vk,
            &proof(&env, note),
            &inputs(&env, &NOTES[1])
        ));
    }

    #[test]
    fn rejects_a_tampered_proof() {
        let env = Env::default();
        let vk = vk(&env);
        let note = &NOTES[0];
        let good = proof(&env, note);
        let inputs = inputs(&env, note);

        // A not negated (as snarkjs outputs it).
        let mut p = good.clone();
        p.a = neg_g1(&good.a);
        assert!(!verify(&env, &vk, &p, &inputs));

        // C replaced by −C, and C replaced by another valid point (A).
        let mut p = good.clone();
        p.c = neg_g1(&good.c);
        assert!(!verify(&env, &vk, &p, &inputs));
        let mut p = good.clone();
        p.c = good.a.clone();
        assert!(!verify(&env, &vk, &p, &inputs));

        // B from another proof.
        let mut p = good.clone();
        p.b = BytesN::from_array(&env, &NOTES[1].b);
        assert!(!verify(&env, &vk, &p, &inputs));

        // A whole proof of another deal.
        assert!(!verify(&env, &vk, &proof(&env, &NOTES[1]), &inputs));
    }

    #[test]
    fn rejects_non_canonical_public_inputs() {
        let env = Env::default();
        let vk = vk(&env);
        let note = &NOTES[0];
        // commitment + r is the same field element but a second encoding.
        let mut tampered = inputs(&env, note);
        let shifted = add_be(&tampered.get_unchecked(4).to_array(), &FR_MODULUS_BE);
        tampered.set(4, BytesN::from_array(&env, &shifted));
        assert!(!verify(&env, &vk, &proof(&env, note), &tampered));
        assert!(!is_canonical_fr(&BytesN::from_array(&env, &FR_MODULUS_BE)));
    }

    #[test]
    fn rejects_a_wrong_number_of_public_inputs() {
        let env = Env::default();
        let vk = vk(&env);
        let note = &NOTES[0];
        let mut short = inputs(&env, note);
        short.pop_back();
        assert!(!verify(&env, &vk, &proof(&env, note), &short));
        let mut long = inputs(&env, note);
        long.push_back(BytesN::from_array(&env, &one()));
        assert!(!verify(&env, &vk, &proof(&env, note), &long));
    }

    #[test]
    #[should_panic]
    fn traps_on_a_point_off_the_curve() {
        let env = Env::default();
        let vk = vk(&env);
        let note = &NOTES[0];
        let mut p = proof(&env, note);
        let mut a = note.a;
        a[63] ^= 1; // y + 1: no longer on the curve
        p.a = BytesN::from_array(&env, &a);
        verify(&env, &vk, &p, &inputs(&env, note));
    }

    #[test]
    fn verification_fits_the_transaction_budget() {
        let env = Env::default();
        let vk = vk(&env);
        let note = &NOTES[0];
        let proof = proof(&env, note);
        let inputs = inputs(&env, note);

        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
        assert!(verify(&env, &vk, &proof, &inputs));
        let cpu = budget.cpu_instruction_cost();
        let mem = budget.memory_bytes_cost();
        std::println!(
            "groth16::verify (9 public inputs): {cpu} CPU instructions, {mem} memory bytes"
        );
        // Testnet per-transaction limit (protocol 29, ConfigSettingContractComputeV0
        // tx_max_instructions, read 2026-10-25): 400,000,000 instructions and
        // 40 MiB of memory. Keep verification under a quarter of it.
        assert!(cpu < 100_000_000, "verification costs {cpu} instructions");
    }

    /// The deploy script passes apps/web/zk/verification_key.soroban.json to the
    /// cpcv_note constructor: it must be the key these tests verify against.
    #[test]
    fn fixture_matches_the_committed_deploy_verification_key() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/web/zk/verification_key.soroban.json"
        );
        let json =
            std::fs::read_to_string(path).expect("apps/web/zk/verification_key.soroban.json");
        let hex = |b: &[u8]| -> std::string::String {
            b.iter().map(|x| std::format!("{x:02x}")).collect()
        };
        for (name, bytes) in [
            ("alpha", &fixture::VK_ALPHA[..]),
            ("beta", &fixture::VK_BETA[..]),
            ("gamma", &fixture::VK_GAMMA[..]),
            ("delta", &fixture::VK_DELTA[..]),
        ] {
            let expected = std::format!("\"{name}\": \"{}\"", hex(bytes));
            assert!(json.contains(&expected), "stale fixture or vk: {name}");
        }
        for (i, ic) in fixture::VK_IC.iter().enumerate() {
            assert!(
                json.contains(&std::format!("\"{}\"", hex(ic))),
                "stale fixture or vk: ic[{i}]"
            );
        }
    }
}
