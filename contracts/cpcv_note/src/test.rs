#![cfg(test)]
extern crate std;

use crate::test_fixture as fx;
use crate::{CpcvNote, CpcvNoteClient};
use advance_shared::{groth16, Error, Groth16Proof, NoteStatus, VerificationKey};
use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, vec, Address, BytesN, Env, String, Vec,
};

// ---------------------------------------------------------------- helpers

fn bytes<const N: usize>(e: &Env, h: &str) -> BytesN<N> {
    let v = hex::decode(h).unwrap();
    BytesN::from_array(e, &v.try_into().unwrap())
}

fn vk(e: &Env) -> VerificationKey {
    let mut ic = Vec::new(e);
    for x in fx::VK_IC {
        ic.push_back(bytes::<64>(e, x));
    }
    VerificationKey {
        alpha: bytes(e, fx::VK_ALPHA),
        beta: bytes(e, fx::VK_BETA),
        gamma: bytes(e, fx::VK_GAMMA),
        delta: bytes(e, fx::VK_DELTA),
        ic,
    }
}

struct Deal {
    proof: Groth16Proof,
    total: u64,
    escritura: u32,
    commitment: BytesN<32>,
    nullifier: BytesN<32>,
}

macro_rules! deal {
    ($e:expr, $m:ident) => {
        Deal {
            proof: Groth16Proof {
                a: bytes($e, fx::$m::A),
                b: bytes($e, fx::$m::B),
                c: bytes($e, fx::$m::C),
            },
            total: fx::$m::TOTAL_COMMISSION_CENTS,
            escritura: fx::$m::ESCRITURA_DAY,
            commitment: bytes($e, fx::$m::COMMITMENT),
            nullifier: bytes($e, fx::$m::NULLIFIER),
        }
    };
}

fn public_inputs(e: &Env, d: &Deal) -> Vec<soroban_sdk::crypto::bn254::Bn254Fr> {
    vec![
        e,
        groth16::fr_from_bytes(e, &bytes(e, fx::AGENT_FIELD)),
        groth16::fr_from_u64(e, d.total),
        groth16::fr_from_u64(e, d.total / 2),
        groth16::fr_from_u64(e, d.escritura as u64),
        groth16::fr_from_bytes(e, &d.commitment),
        groth16::fr_from_bytes(e, &d.nullifier),
        groth16::fr_from_bytes(e, &bytes(e, fx::ATTESTER_AX)),
        groth16::fr_from_bytes(e, &bytes(e, fx::ATTESTER_AY)),
        groth16::fr_from_bytes(e, &bytes(e, fx::NULLIFIER_SECRET_COMMITMENT)),
    ]
}

/// Minimal stand-in for `advance_pool`: a clock and a record of opened lines.
#[contracttype]
enum MockKey {
    Now,
    Lines,
}

#[contract]
pub struct MockPool;

#[contractimpl]
impl MockPool {
    pub fn set_now(e: Env, now: u64) {
        e.storage().instance().set(&MockKey::Now, &now);
    }
    pub fn protocol_now(e: Env) -> u64 {
        e.storage().instance().get(&MockKey::Now).unwrap_or(0)
    }
    pub fn open_line(e: Env, note_id: u32, _agent: Address, _agent_commission: i128, _escritura_day: u32) {
        let mut lines: Vec<u32> = e.storage().instance().get(&MockKey::Lines).unwrap_or(Vec::new(&e));
        lines.push_back(note_id);
        e.storage().instance().set(&MockKey::Lines, &lines);
    }
    pub fn lines(e: Env) -> Vec<u32> {
        e.storage().instance().get(&MockKey::Lines).unwrap_or(Vec::new(&e))
    }
    pub fn settle(e: Env, note: Address, id: u32) {
        crate::CpcvNoteClient::new(&e, &note).set_status(&id, &NoteStatus::Settled);
    }
}

struct Setup<'a> {
    e: Env,
    note: CpcvNoteClient<'a>,
    pool: MockPoolClient<'a>,
    agent: Address,
}

fn setup_with(ax: &str, nsc: &str) -> Setup<'static> {
    let e = Env::default();
    e.mock_all_auths();
    e.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&e);
    let operator = Address::generate(&e);
    let note_id = e.register(
        CpcvNote,
        (
            admin,
            operator,
            bytes::<32>(&e, ax),
            bytes::<32>(&e, fx::ATTESTER_AY),
            bytes::<32>(&e, nsc),
            vk(&e),
            String::from_str(&e, "http://localhost:3000/api/registry"),
        ),
    );
    let pool_id = e.register(MockPool, ());
    let note = CpcvNoteClient::new(&e, &note_id);
    let pool = MockPoolClient::new(&e, &pool_id);
    note.set_pool(&pool_id);
    // CPCV day 20_000 ≈ Oct 2024; protocol "today" sits before both escrituras.
    pool.set_now(&(20_005u64 * 86_400));
    let agent = Address::from_str(&e, fx::AGENT);
    Setup { e, note, pool, agent }
}

fn setup() -> Setup<'static> {
    setup_with(fx::ATTESTER_AX, fx::NULLIFIER_SECRET_COMMITMENT)
}

fn mint(s: &Setup, to: &Address, d: &Deal) -> Result<u32, Error> {
    match s
        .note
        .try_mint(to, &d.proof, &d.total, &d.escritura, &d.commitment, &d.nullifier)
    {
        Ok(Ok(id)) => Ok(id),
        Err(Ok(err)) => Err(err),
        other => panic!("unexpected result: {:?}", other),
    }
}

// ---------------------------------------------------------------- Groth16

#[test]
fn groth16_verifies_snarkjs_fixture() {
    let e = Env::default();
    e.cost_estimate().budget().reset_unlimited();
    let d = deal!(&e, deal1);
    assert!(groth16::verify(&e, &vk(&e), &d.proof, &public_inputs(&e, &d)));
    let d2 = deal!(&e, deal2);
    assert!(groth16::verify(&e, &vk(&e), &d2.proof, &public_inputs(&e, &d2)));
}

#[test]
fn groth16_rejects_tampered_public_input() {
    let e = Env::default();
    e.cost_estimate().budget().reset_unlimited();
    let mut d = deal!(&e, deal1);
    d.total += 1;
    assert!(!groth16::verify(&e, &vk(&e), &d.proof, &public_inputs(&e, &d)));
}

#[test]
fn groth16_rejects_tampered_proof() {
    let e = Env::default();
    e.cost_estimate().budget().reset_unlimited();
    let d = deal!(&e, deal1);
    let other = deal!(&e, deal2);
    // Swap in another valid proof's C: still on curve, but the pairing fails.
    let tampered = Groth16Proof { c: other.proof.c.clone(), ..d.proof.clone() };
    assert!(!groth16::verify(&e, &vk(&e), &tampered, &public_inputs(&e, &d)));
    // Un-negated A must also fail.
    let a = d.proof.a.to_array();
    let mut y = [0u8; 32];
    y.copy_from_slice(&a[32..]);
    let fp: [u8; 32] = hex::decode("30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47")
        .unwrap()
        .try_into()
        .unwrap();
    // p − y with big-endian borrow arithmetic.
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let v = fp[i] as i16 - y[i] as i16 - borrow;
        borrow = if v < 0 { 1 } else { 0 };
        out[i] = (v + 256 * borrow) as u8;
    }
    let mut pos_a = [0u8; 64];
    pos_a[..32].copy_from_slice(&a[..32]);
    pos_a[32..].copy_from_slice(&out);
    let positive = Groth16Proof { a: BytesN::from_array(&e, &pos_a), ..d.proof.clone() };
    assert!(!groth16::verify(&e, &vk(&e), &positive, &public_inputs(&e, &d)));
}

#[test]
fn canonical_field_check() {
    let e = Env::default();
    let r = BytesN::from_array(&e, &groth16::FR_MODULUS_BE);
    assert!(!groth16::is_canonical_fr(&r));
    let mut below = groth16::FR_MODULUS_BE;
    below[31] -= 1;
    assert!(groth16::is_canonical_fr(&BytesN::from_array(&e, &below)));
}

// ---------------------------------------------------------------- cpcv_note

#[test]
fn agent_field_matches_typescript() {
    let s = setup();
    assert_eq!(s.note.agent_field(&s.agent), bytes::<32>(&s.e, fx::AGENT_FIELD));
}

#[test]
fn mint_happy_path() {
    let s = setup();
    let d = deal!(&s.e, deal1);
    let id = mint(&s, &s.agent, &d).unwrap();
    assert_eq!(id, 1);
    let note = s.note.get(&id);
    assert_eq!(note.agent, s.agent);
    assert_eq!(note.total_commission, 15_000_0000000); // €15,000
    assert_eq!(note.agent_commission, 7_500_0000000);
    assert_eq!(note.explorador_commission, 7_500_0000000);
    assert_eq!(note.status, NoteStatus::Active);
    assert_eq!(note.escritura_day, 20_090);
    assert_eq!(s.note.owner_of(&id), s.agent);
    assert_eq!(s.note.balance(&s.agent), 1);
    assert_eq!(s.note.count(), 1);
    assert_eq!(s.note.notes_of(&s.agent), vec![&s.e, 1u32]);
    assert!(s.note.nullifier_used(&d.nullifier));
    assert_eq!(s.pool.lines(), vec![&s.e, 1u32]);
    assert_eq!(s.note.token_uri(&id), String::from_str(&s.e, "http://localhost:3000/api/registry/1"));
    assert_eq!(s.note.name(), String::from_str(&s.e, "explorador advance CPCV Note"));
    assert_eq!(s.note.symbol(), String::from_str(&s.e, "eaNOTE"));

    let id2 = mint(&s, &s.agent, &deal!(&s.e, deal2)).unwrap();
    assert_eq!(id2, 2);
    assert_eq!(s.note.list(&1, &50).len(), 2);
    assert_eq!(s.note.list(&2, &1).get(0).unwrap().id, 2);
}

#[test]
fn mint_rejects_duplicate_nullifier() {
    let s = setup();
    mint(&s, &s.agent, &deal!(&s.e, deal1)).unwrap();
    // Same deal, new salt: valid proof, different commitment, same nullifier.
    assert_eq!(mint(&s, &s.agent, &deal!(&s.e, deal1b)), Err(Error::NullifierUsed));
}

#[test]
fn mint_rejects_duplicate_commitment() {
    let s = setup();
    let d = deal!(&s.e, deal1);
    mint(&s, &s.agent, &d).unwrap();
    let mut dup = deal!(&s.e, deal2);
    dup.commitment = d.commitment.clone();
    assert_eq!(mint(&s, &s.agent, &dup), Err(Error::CommitmentUsed));
}

#[test]
fn mint_rejects_wrong_attester_key() {
    // A different (valid-looking) attester x coordinate changes the public input.
    let s = setup_with(fx::NULLIFIER_SECRET_COMMITMENT, fx::NULLIFIER_SECRET_COMMITMENT);
    assert_eq!(mint(&s, &s.agent, &deal!(&s.e, deal1)), Err(Error::InvalidProof));
}

#[test]
fn mint_rejects_wrong_nullifier_secret_commitment() {
    let s = setup_with(fx::ATTESTER_AX, fx::ATTESTER_AX);
    assert_eq!(mint(&s, &s.agent, &deal!(&s.e, deal1)), Err(Error::InvalidProof));
}

#[test]
fn mint_rejects_escritura_in_past() {
    let s = setup();
    s.pool.set_now(&(20_090u64 * 86_400 + 10));
    assert_eq!(mint(&s, &s.agent, &deal!(&s.e, deal1)), Err(Error::EscrituraInPast));
}

#[test]
fn mint_to_different_address_fails() {
    let s = setup();
    let other = Address::from_str(&s.e, fx::OTHER);
    assert_eq!(mint(&s, &other, &deal!(&s.e, deal1)), Err(Error::InvalidProof));
    let random = Address::generate(&s.e);
    assert_eq!(mint(&s, &random, &deal!(&s.e, deal1)), Err(Error::InvalidProof));
}

#[test]
fn mint_rejects_tampered_commission() {
    let s = setup();
    let mut d = deal!(&s.e, deal1);
    d.total *= 2;
    assert_eq!(mint(&s, &s.agent, &d), Err(Error::InvalidProof));
}

#[test]
fn mint_rejects_non_canonical_nullifier() {
    let s = setup();
    let mut d = deal!(&s.e, deal1);
    d.nullifier = BytesN::from_array(&s.e, &groth16::FR_MODULUS_BE);
    assert_eq!(mint(&s, &s.agent, &d), Err(Error::NonCanonicalField));
}

#[test]
fn soulbound_transfers_and_approvals_fail() {
    let s = setup();
    let id = mint(&s, &s.agent, &deal!(&s.e, deal1)).unwrap();
    let other = Address::generate(&s.e);
    assert_eq!(
        s.note.try_transfer(&s.agent, &other, &id).err().unwrap().unwrap(),
        Error::Soulbound.into()
    );
    assert_eq!(
        s.note.try_transfer_from(&other, &s.agent, &other, &id).err().unwrap().unwrap(),
        Error::Soulbound.into()
    );
    assert_eq!(
        s.note.try_approve(&s.agent, &other, &id, &1000).err().unwrap().unwrap(),
        Error::Soulbound.into()
    );
    assert_eq!(
        s.note.try_approve_for_all(&s.agent, &other, &1000).err().unwrap().unwrap(),
        Error::Soulbound.into()
    );
    assert_eq!(s.note.owner_of(&id), s.agent);
}

#[test]
fn set_status_only_from_pool() {
    let s = setup();
    let id = mint(&s, &s.agent, &deal!(&s.e, deal1)).unwrap();
    s.pool.settle(&s.note.address, &id);
    assert_eq!(s.note.get(&id).status, NoteStatus::Settled);
}

#[test]
fn set_pool_only_once() {
    let s = setup();
    let again = Address::generate(&s.e);
    assert_eq!(s.note.try_set_pool(&again), Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn verification_cost_fits_budget() {
    let s = setup();
    s.e.cost_estimate().budget().reset_default();
    mint(&s, &s.agent, &deal!(&s.e, deal1)).unwrap();
    std::println!("mint cpu insns: {}", s.e.cost_estimate().budget().cpu_instruction_cost());
}
