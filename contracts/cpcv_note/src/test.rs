//! cpcv_note tests (spec §12.1) against real Groth16 proofs from the shared
//! fixture (scripts/vk-to-soroban.ts) and a mock advance_pool.

extern crate std;

use advance_shared::{Error, Groth16Proof, Note, NoteStatus, VerificationKey};
use soroban_sdk::{
    testutils::{
        storage::Persistent as _, Address as _, EnvTestConfig, Events as _, MockAuth,
        MockAuthInvoke,
    },
    vec, Address, BytesN, Env, Event, IntoVal, String, Vec,
};

use crate::{
    CpcvNote, CpcvNoteClient, DataKey, NoteMinted, NoteStatusChanged, PERSISTENT_THRESHOLD,
};

#[allow(dead_code)]
mod fixture {
    include!("../../shared/fixtures/groth16_fixture.rs");
}
use fixture::{FixtureNote, NOTES};

const BASE_URI: &str = "https://advance.explorador.ai/api/registry";
const STROOPS_PER_CENT: i128 = 100_000;

/// A test Env that does not write test_snapshots/ JSON files.
fn test_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

mod mock_pool {
    use advance_shared::{interfaces::NoteClient, Note, NoteStatus};
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

    #[contracttype]
    enum Key {
        NoteContract,
        Now,
        Opened,
    }

    /// Implements `PoolInterface` (open_line, protocol_now) and calls
    /// `set_status` like settle/cancel do.
    #[contract]
    pub struct MockPool;

    #[contractimpl]
    impl MockPool {
        pub fn init(e: Env, note_contract: Address, now: u64) {
            e.storage()
                .instance()
                .set(&Key::NoteContract, &note_contract);
            e.storage().instance().set(&Key::Now, &now);
        }

        pub fn set_now(e: Env, now: u64) {
            e.storage().instance().set(&Key::Now, &now);
        }

        pub fn protocol_now(e: Env) -> u64 {
            e.storage().instance().get(&Key::Now).unwrap()
        }

        /// Note contract only, like the real pool.
        pub fn open_line(e: Env, note: Note) {
            let note_contract: Address = e.storage().instance().get(&Key::NoteContract).unwrap();
            note_contract.require_auth();
            let mut opened = Self::opened(e.clone());
            opened.push_back(note);
            e.storage().instance().set(&Key::Opened, &opened);
        }

        pub fn opened(e: Env) -> Vec<Note> {
            e.storage()
                .instance()
                .get(&Key::Opened)
                .unwrap_or_else(|| Vec::new(&e))
        }

        pub fn set_note_status(e: Env, id: u32, status: NoteStatus) {
            let note_contract: Address = e.storage().instance().get(&Key::NoteContract).unwrap();
            NoteClient::new(&e, &note_contract).set_status(&id, &status);
        }
    }
}
use mock_pool::{MockPool, MockPoolClient};

struct Setup<'a> {
    env: Env,
    note: CpcvNoteClient<'a>,
    pool: MockPoolClient<'a>,
    admin: Address,
    operator: Address,
}

fn bytes32(env: &Env, b: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, b)
}

fn fixture_vk(env: &Env) -> VerificationKey {
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

fn proof(env: &Env, n: &FixtureNote) -> Groth16Proof {
    Groth16Proof {
        a: BytesN::from_array(env, &n.a),
        b: BytesN::from_array(env, &n.b),
        c: BytesN::from_array(env, &n.c),
    }
}

fn agent(env: &Env, n: &FixtureNote) -> Address {
    Address::from_str(env, n.agent)
}

/// Protocol time one hour into the fixture's CPCV day.
fn cpcv_time() -> u64 {
    u64::from(fixture::CPCV_DAY) * 86_400 + 3_600
}

fn setup_with(ax: &[u8; 32], ay: &[u8; 32], nsc: &[u8; 32]) -> Setup<'static> {
    let env = test_env();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let note_id = env.register(
        CpcvNote,
        (
            admin.clone(),
            operator.clone(),
            bytes32(&env, ax),
            bytes32(&env, ay),
            bytes32(&env, nsc),
            fixture_vk(&env),
            String::from_str(&env, BASE_URI),
        ),
    );
    let pool_id = env.register(MockPool, ());
    let note = CpcvNoteClient::new(&env, &note_id);
    let pool = MockPoolClient::new(&env, &pool_id);
    pool.init(&note_id, &cpcv_time());
    note.set_pool(&pool_id);
    Setup {
        env,
        note,
        pool,
        admin,
        operator,
    }
}

fn setup() -> Setup<'static> {
    setup_with(
        &fixture::ATTESTER_AX,
        &fixture::ATTESTER_AY,
        &fixture::NULLIFIER_SECRET_COMMITMENT,
    )
}

impl Setup<'_> {
    fn try_mint_as(&self, i: usize, to: &Address) -> Result<u32, Error> {
        let n = &NOTES[i];
        match self.note.try_mint(
            to,
            &proof(&self.env, n),
            &n.total_commission_cents,
            &n.escritura_day,
            &bytes32(&self.env, &n.commitment),
            &bytes32(&self.env, &n.nullifier),
        ) {
            Ok(Ok(id)) => Ok(id),
            Err(Ok(e)) => Err(e),
            other => panic!("unexpected mint result: {other:?}"),
        }
    }

    fn try_mint(&self, i: usize) -> Result<u32, Error> {
        self.try_mint_as(i, &agent(&self.env, &NOTES[i]))
    }

    fn mint(&self, i: usize) -> u32 {
        self.try_mint(i).expect("mint failed")
    }
}

#[test]
fn mint_happy_path() {
    let s = setup();
    let n = &NOTES[0]; // worked example: €15,000 total commission
    let to = agent(&s.env, n);

    let id = s.mint(0);
    assert_eq!(id, 1);

    let note = s.note.get(&id);
    assert_eq!(
        note,
        Note {
            id: 1,
            agent: to.clone(),
            total_commission: 1_500_000 * STROOPS_PER_CENT,
            agent_commission: 750_000 * STROOPS_PER_CENT,
            explorador_commission: 750_000 * STROOPS_PER_CENT,
            escritura_day: n.escritura_day,
            commitment: bytes32(&s.env, &n.commitment),
            nullifier: bytes32(&s.env, &n.nullifier),
            proof: proof(&s.env, n),
            minted_at: cpcv_time(),
            status: NoteStatus::Active,
        }
    );

    // registry views
    assert_eq!(s.note.count(), 1);
    assert_eq!(s.note.list(&0, &50), vec![&s.env, note.clone()]);
    assert_eq!(s.note.notes_of(&to), vec![&s.env, 1u32]);
    assert!(s.note.nullifier_used(&bytes32(&s.env, &n.nullifier)));
    assert!(!s.note.nullifier_used(&bytes32(&s.env, &NOTES[1].nullifier)));

    // SEP-50
    assert_eq!(s.note.owner_of(&id), to);
    assert_eq!(s.note.balance(&to), 1);
    assert_eq!(
        s.note.name(),
        String::from_str(&s.env, "explorador advance CPCV Note")
    );
    assert_eq!(s.note.symbol(), String::from_str(&s.env, "eaNOTE"));
    assert_eq!(
        s.note.token_uri(&id),
        String::from_str(&s.env, "https://advance.explorador.ai/api/registry/1")
    );

    // the pool got the stored note by value
    assert_eq!(s.pool.opened(), vec![&s.env, note]);

    // TTLs extended on write
    s.env.as_contract(&s.note.address, || {
        let ttl = s.env.storage().persistent().get_ttl(&DataKey::Note(1));
        assert!(ttl >= PERSISTENT_THRESHOLD, "note TTL {ttl}");
        let ttl = s
            .env
            .storage()
            .persistent()
            .get_ttl(&DataKey::NullifierUsed(bytes32(&s.env, &n.nullifier)));
        assert!(ttl >= PERSISTENT_THRESHOLD, "nullifier TTL {ttl}");
    });
}

#[test]
fn mint_emits_note_minted() {
    let s = setup();
    let n = &NOTES[0];
    s.mint(0);
    let events = s.env.events().all().filter_by_contract(&s.note.address);
    let expected = NoteMinted {
        id: 1,
        agent: agent(&s.env, n),
        total_commission: 1_500_000 * STROOPS_PER_CENT,
        agent_commission: 750_000 * STROOPS_PER_CENT,
        escritura_day: n.escritura_day,
        commitment: bytes32(&s.env, &n.commitment),
        nullifier: bytes32(&s.env, &n.nullifier),
    }
    .to_xdr(&s.env, &s.note.address);
    assert_eq!(events.events().last(), Some(&expected));
    // default #[contractevent] layout: first topic is the snake_case name
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &expected.body;
    assert_eq!(
        body.topics[0],
        soroban_sdk::xdr::ScVal::Symbol(soroban_sdk::xdr::ScSymbol(
            "note_minted".try_into().unwrap()
        ))
    );
}

#[test]
fn mints_several_notes_and_lists_them() {
    let s = setup();
    let a = agent(&s.env, &NOTES[0]);
    let b = agent(&s.env, &NOTES[2]);
    assert_eq!(s.mint(0), 1);
    assert_eq!(s.mint(1), 2);
    assert_eq!(s.mint(2), 3);

    assert_eq!(s.note.count(), 3);
    let ids = |notes: Vec<Note>| -> std::vec::Vec<u32> { notes.iter().map(|n| n.id).collect() };
    assert_eq!(ids(s.note.list(&0, &50)), [1, 2, 3]);
    assert_eq!(ids(s.note.list(&1, &2)), [1, 2]);
    assert_eq!(ids(s.note.list(&2, &1)), [2]);
    assert_eq!(ids(s.note.list(&3, &10)), [3]);
    assert_eq!(ids(s.note.list(&4, &10)), [0u32; 0]);
    assert_eq!(ids(s.note.list(&1, &1000)), [1, 2, 3]); // limit capped at 50
    assert_eq!(s.note.notes_of(&a), vec![&s.env, 1u32, 2]);
    assert_eq!(s.note.notes_of(&b), vec![&s.env, 3u32]);
    assert_eq!(s.note.balance(&a), 2);

    // odd total commission: agent gets floor(total / 2), explorador the rest
    let odd = s.note.get(&3);
    assert_eq!(odd.total_commission, 808_451 * STROOPS_PER_CENT);
    assert_eq!(odd.agent_commission, 404_225 * STROOPS_PER_CENT);
    assert_eq!(odd.explorador_commission, 404_226 * STROOPS_PER_CENT);
    assert_eq!(s.pool.opened().len(), 3);
}

#[test]
fn rejects_a_duplicate_nullifier() {
    let s = setup();
    s.mint(0);
    assert_eq!(s.try_mint(0), Err(Error::NullifierUsed));
}

#[test]
fn rejects_a_duplicate_commitment() {
    let s = setup();
    s.mint(0);
    // Same commitment with a fresh nullifier: rejected before the proof is checked.
    let n = &NOTES[0];
    let res = s.note.try_mint(
        &agent(&s.env, n),
        &proof(&s.env, n),
        &n.total_commission_cents,
        &n.escritura_day,
        &bytes32(&s.env, &n.commitment),
        &bytes32(&s.env, &[7u8; 32]),
    );
    assert_eq!(res, Err(Ok(Error::CommitmentUsed)));
}

#[test]
fn rejects_a_proof_signed_for_another_attester_key() {
    let s = setup_with(
        &fixture::OTHER_ATTESTER_AX,
        &fixture::OTHER_ATTESTER_AY,
        &fixture::NULLIFIER_SECRET_COMMITMENT,
    );
    assert_eq!(s.try_mint(0), Err(Error::InvalidProof));
}

#[test]
fn rejects_a_wrong_nullifier_secret_commitment() {
    let mut nsc = fixture::NULLIFIER_SECRET_COMMITMENT;
    nsc[31] ^= 1;
    let s = setup_with(&fixture::ATTESTER_AX, &fixture::ATTESTER_AY, &nsc);
    assert_eq!(s.try_mint(0), Err(Error::InvalidProof));
}

#[test]
fn rejects_an_escritura_in_the_past() {
    let s = setup();
    let n = &NOTES[0];
    // protocol "today" == escritura day: not strictly after
    s.pool.set_now(&(u64::from(n.escritura_day) * 86_400));
    assert_eq!(s.try_mint(0), Err(Error::EscrituraInPast));
    s.pool
        .set_now(&(u64::from(n.escritura_day) * 86_400 + 86_399));
    assert_eq!(s.try_mint(0), Err(Error::EscrituraInPast));
    // the last second of the day before is fine
    s.pool.set_now(&(u64::from(n.escritura_day) * 86_400 - 1));
    assert_eq!(s.try_mint(0), Ok(1));
}

#[test]
fn rejects_minting_to_an_address_other_than_the_proven_agent() {
    let s = setup();
    let other = agent(&s.env, &NOTES[2]); // agent B; NOTES[0] was proven for agent A
    assert_eq!(s.try_mint_as(0, &other), Err(Error::InvalidProof));
    assert_eq!(
        s.try_mint_as(0, &Address::generate(&s.env)),
        Err(Error::InvalidProof)
    );
    assert_eq!(s.note.count(), 0);
}

#[test]
fn rejects_tampered_amounts_and_dates() {
    let s = setup();
    let n = &NOTES[0];
    let to = agent(&s.env, n);
    let try_with = |total: u64, day: u32| {
        s.note.try_mint(
            &to,
            &proof(&s.env, n),
            &total,
            &day,
            &bytes32(&s.env, &n.commitment),
            &bytes32(&s.env, &n.nullifier),
        )
    };
    assert_eq!(
        try_with(n.total_commission_cents + 2, n.escritura_day),
        Err(Ok(Error::InvalidProof))
    );
    assert_eq!(
        try_with(n.total_commission_cents + 1, n.escritura_day),
        Err(Ok(Error::InvalidProof))
    );
    assert_eq!(
        try_with(n.total_commission_cents, n.escritura_day + 1),
        Err(Ok(Error::InvalidProof))
    );
    assert_eq!(try_with(0, n.escritura_day), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn rejects_a_proof_with_another_notes_points() {
    let s = setup();
    let n = &NOTES[0];
    let mut p = proof(&s.env, n);
    p.c = BytesN::from_array(&s.env, &NOTES[1].c);
    let res = s.note.try_mint(
        &agent(&s.env, n),
        &p,
        &n.total_commission_cents,
        &n.escritura_day,
        &bytes32(&s.env, &n.commitment),
        &bytes32(&s.env, &n.nullifier),
    );
    assert_eq!(res, Err(Ok(Error::InvalidProof)));
}

#[test]
fn notes_are_soulbound() {
    let s = setup();
    let id = s.mint(0);
    let owner = agent(&s.env, &NOTES[0]);
    let other = Address::generate(&s.env);
    let soulbound = soroban_sdk::Error::from_contract_error(Error::Soulbound as u32);

    assert_eq!(s.note.try_transfer(&owner, &other, &id), Err(Ok(soulbound)));
    assert_eq!(
        s.note.try_transfer_from(&other, &owner, &other, &id),
        Err(Ok(soulbound))
    );
    assert_eq!(
        s.note.try_approve(&owner, &other, &id, &1000),
        Err(Ok(soulbound))
    );
    assert_eq!(
        s.note.try_approve_for_all(&owner, &other, &1000),
        Err(Ok(soulbound))
    );

    assert_eq!(s.note.owner_of(&id), owner);
    assert_eq!(s.note.get_approved(&id), None);
    assert!(!s.note.is_approved_for_all(&owner, &other));
}

#[test]
fn mint_requires_only_the_operator_signature() {
    // No mock_all_auths: the operator authorizes `mint` exactly; the pool's
    // note_contract.require_auth() in open_line passes as invoker auth.
    let s = setup();
    let n = &NOTES[0];
    let to = agent(&s.env, n);
    let args = (
        to.clone(),
        proof(&s.env, n),
        n.total_commission_cents,
        n.escritura_day,
        bytes32(&s.env, &n.commitment),
        bytes32(&s.env, &n.nullifier),
    );
    s.env.mock_auths(&[MockAuth {
        address: &s.operator,
        invoke: &MockAuthInvoke {
            contract: &s.note.address,
            fn_name: "mint",
            args: args.clone().into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        s.note
            .mint(&args.0, &args.1, &args.2, &args.3, &args.4, &args.5),
        1
    );

    // Anyone else (here: the admin) cannot mint.
    let n = &NOTES[1];
    let args = (
        agent(&s.env, n),
        proof(&s.env, n),
        n.total_commission_cents,
        n.escritura_day,
        bytes32(&s.env, &n.commitment),
        bytes32(&s.env, &n.nullifier),
    );
    s.env.mock_auths(&[MockAuth {
        address: &s.admin,
        invoke: &MockAuthInvoke {
            contract: &s.note.address,
            fn_name: "mint",
            args: args.clone().into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s
        .note
        .try_mint(&args.0, &args.1, &args.2, &args.3, &args.4, &args.5)
        .is_err());
    assert_eq!(s.note.count(), 1);
}

#[test]
fn set_pool_is_admin_only_and_once() {
    let env = test_env();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(
        CpcvNote,
        (
            admin.clone(),
            Address::generate(&env),
            bytes32(&env, &fixture::ATTESTER_AX),
            bytes32(&env, &fixture::ATTESTER_AY),
            bytes32(&env, &fixture::NULLIFIER_SECRET_COMMITMENT),
            fixture_vk(&env),
            String::from_str(&env, BASE_URI),
        ),
    );
    let note = CpcvNoteClient::new(&env, &id);
    let n = &NOTES[0];

    // Minting before the pool is wired fails.
    let res = note.try_mint(
        &agent(&env, n),
        &proof(&env, n),
        &n.total_commission_cents,
        &n.escritura_day,
        &bytes32(&env, &n.commitment),
        &bytes32(&env, &n.nullifier),
    );
    assert_eq!(res, Err(Ok(Error::PoolNotSet)));

    let pool = Address::generate(&env);
    note.set_pool(&pool);
    assert_eq!(env.auths()[0].0, admin);
    assert_eq!(
        note.try_set_pool(&Address::generate(&env)),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn set_status_is_pool_only() {
    let s = setup();
    let id = s.mint(0);

    // The pool contract settles: invoker auth, no signature needed.
    s.env.set_auths(&[]);
    s.pool.set_note_status(&id, &NoteStatus::Settled);
    let events = s.env.events().all().filter_by_contract(&s.note.address);
    assert_eq!(
        events.events().last(),
        Some(
            &NoteStatusChanged {
                id,
                status: NoteStatus::Settled
            }
            .to_xdr(&s.env, &s.note.address)
        )
    );
    assert_eq!(s.note.get(&id).status, NoteStatus::Settled);

    // Anyone else is rejected.
    assert!(s.note.try_set_status(&id, &NoteStatus::Cancelled).is_err());
    assert_eq!(s.note.get(&id).status, NoteStatus::Settled);

    // Unknown note.
    s.env.mock_all_auths();
    assert_eq!(
        s.note.try_set_status(&99, &NoteStatus::Cancelled),
        Err(Ok(Error::UnknownNote))
    );
}

#[test]
fn views_report_unknown_notes_and_deploy_parameters() {
    let s = setup();
    assert_eq!(s.note.try_get(&1), Err(Ok(Error::UnknownNote)));
    assert_eq!(s.note.count(), 0);
    assert_eq!(s.note.list(&0, &50).len(), 0);
    assert_eq!(s.note.notes_of(&Address::generate(&s.env)).len(), 0);
    assert_eq!(s.note.verification_key(), fixture_vk(&s.env));
    let params = s.note.attester_params();
    assert_eq!(params.attester_ax, bytes32(&s.env, &fixture::ATTESTER_AX));
    assert_eq!(params.attester_ay, bytes32(&s.env, &fixture::ATTESTER_AY));
    assert_eq!(
        params.nullifier_secret_commitment,
        bytes32(&s.env, &fixture::NULLIFIER_SECRET_COMMITMENT)
    );
}

/// agent_field parity (spec §8.4). The hex values are asserted again in
/// apps/web/lib/zk/zk.test.ts against `agentFieldHex` (TypeScript).
#[test]
fn agent_field_matches_the_typescript_encoding() {
    let s = setup();
    let hex = |b: BytesN<32>| -> std::string::String {
        b.to_array()
            .iter()
            .map(|x| std::format!("{x:02x}"))
            .collect()
    };
    let got: std::vec::Vec<std::string::String> = PARITY_VECTORS
        .iter()
        .map(|(strkey, _)| hex(s.note.agent_field(&Address::from_str(&s.env, strkey))))
        .collect();
    for ((strkey, _), got) in PARITY_VECTORS.iter().zip(&got) {
        std::println!("agent_field({strkey}) = {got}");
    }
    for ((strkey, expected), got) in PARITY_VECTORS.iter().zip(&got) {
        assert_eq!(got, expected, "{strkey}");
    }
    // The fixture's public input 0 was computed by lib/zk (TypeScript).
    for n in NOTES.iter() {
        assert_eq!(
            s.note.agent_field(&agent(&s.env, n)),
            bytes32(&s.env, &n.public_inputs[0])
        );
    }
}

const PARITY_VECTORS: [(&str, &str); 3] = [
    (
        "CCI4DBTXGTZMSKIJHYUCXHR434R6K5EYVVSB2N6G4G6KBJAJFDTEWMQR",
        "0078290f326375db04aff8e7ac4402b5e38ad45e867c79bfa8c89775cfb1e9a7",
    ),
    (
        "CCU64FTJA23BECHA5JRMQN3CBRJ73KZ6PDJDHMVD4UGEMPSCPGASD3XU",
        "000b0af44ccb5cc1a7058a7dcbcabb5238742d71e5408ee3cb519ca8e4871bfb",
    ),
    (
        "GCTJ2YBXFXA7YIHPJDTWYOCB7PKXMYEGZ2OYPZ6FGP6LKNQPUU3UOPUS",
        "00cd2c87bb8c251e9c3812a09e1563bbb31385587a341e0ed2d7ec333f2b7cc2",
    ),
];

/// Same as the native cost test, but runs the optimized wasm so the contract's
/// own instructions are metered too. Needs `stellar contract build` first:
/// `cargo test -p cpcv_note -- --ignored --nocapture`.
#[test]
#[ignore = "needs target/wasm32v1-none/release/cpcv_note.wasm (stellar contract build)"]
fn wasm_mint_cost_fits_the_transaction_budget() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../target/wasm32v1-none/release/cpcv_note.wasm");
    let wasm = std::fs::read(&path)
        .expect("build the wasm first: stellar contract build --package cpcv_note");
    let env = test_env();
    env.mock_all_auths();
    let note_id = env.register(
        wasm.as_slice(),
        (
            Address::generate(&env),
            Address::generate(&env),
            bytes32(&env, &fixture::ATTESTER_AX),
            bytes32(&env, &fixture::ATTESTER_AY),
            bytes32(&env, &fixture::NULLIFIER_SECRET_COMMITMENT),
            fixture_vk(&env),
            String::from_str(&env, BASE_URI),
        ),
    );
    let pool_id = env.register(MockPool, ());
    let note = CpcvNoteClient::new(&env, &note_id);
    MockPoolClient::new(&env, &pool_id).init(&note_id, &cpcv_time());
    note.set_pool(&pool_id);

    let n = &NOTES[0];
    let mut budget = env.cost_estimate().budget();
    budget.reset_unlimited();
    let id = note.mint(
        &agent(&env, n),
        &proof(&env, n),
        &n.total_commission_cents,
        &n.escritura_day,
        &bytes32(&env, &n.commitment),
        &bytes32(&env, &n.nullifier),
    );
    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();
    std::println!(
        "cpcv_note.mint (wasm): {cpu} CPU instructions, {mem} memory bytes ({} byte wasm)",
        wasm.len()
    );
    assert_eq!(id, 1);
    assert!(cpu < 100_000_000, "mint costs {cpu} instructions");
}

#[test]
fn mint_cost_fits_the_transaction_budget() {
    let s = setup();
    let mut budget = s.env.cost_estimate().budget();
    budget.reset_unlimited();
    s.mint(0);
    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();
    std::println!("cpcv_note.mint (native contract code, metered host calls): {cpu} CPU instructions, {mem} memory bytes");
    assert!(cpu < 100_000_000, "mint costs {cpu} instructions");
}
