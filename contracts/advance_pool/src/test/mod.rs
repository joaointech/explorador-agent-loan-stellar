//! Test harness: the real `teurc` token, a mock `cpcv_note` and helpers.

extern crate std;

mod clock;
mod credit;
mod outcomes;
mod vault;
mod worked_example;

use core::cell::Cell;

use advance_shared::{interfaces::PoolClient, Groth16Proof, Note, NoteStatus};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, EnvTestConfig, Ledger as _},
    Address, BytesN, Env,
};
use teurc::{Teurc, TeurcClient};

use crate::{AdvancePool, AdvancePoolClient, AgentPosition, DrawResult, Params, PoolStats};

/// 1 tEURC in stroops.
pub const EUR: i128 = 10_000_000;
/// 1 EUR cent in stroops.
pub const CENT: i128 = 100_000;
pub const DAY: u64 = 86_400;
/// 2026-10-25T00:00:00Z: the tests' ledger start time.
pub const START: u64 = 1_792_886_400;

pub fn default_params() -> Params {
    Params {
        agent_apr_bps: 1200,
        protocol_fee_bps: 1000,
        senior_target_bps: 800,
        ltv_bps: 5000,
        grace_period_secs: 180 * DAY,
        max_leverage: 10,
        demo_mode: true,
    }
}

// ---------------------------------------------------------------- mock cpcv_note

#[contracttype]
#[derive(Clone)]
enum MockKey {
    Pool,
    Next,
    Note(u32),
}

/// Stands in for `cpcv_note`: stores notes, opens their line on the pool as
/// the note contract (inside `mint`, like the real one) and implements the
/// `NoteInterface` (`get`, `set_status`) the pool calls.
#[contract]
pub struct MockNote;

#[contractimpl]
impl MockNote {
    pub fn set_pool(e: Env, pool: Address) {
        e.storage().instance().set(&MockKey::Pool, &pool);
    }

    /// `cpcv_note.mint` without the proof: stores the note, then calls
    /// `pool.open_line(note)`.
    pub fn mint(e: Env, agent: Address, total_commission: i128, escritura_day: u32) -> u32 {
        let pool = PoolClient::new(&e, &Self::pool(&e));
        let id: u32 = e.storage().instance().get(&MockKey::Next).unwrap_or(1);
        e.storage().instance().set(&MockKey::Next, &(id + 1));
        let agent_commission = total_commission / 2;
        let mut seed = [0u8; 32];
        seed[..4].copy_from_slice(&id.to_be_bytes());
        let note = Note {
            id,
            agent,
            total_commission,
            agent_commission,
            explorador_commission: total_commission - agent_commission,
            escritura_day,
            commitment: BytesN::from_array(&e, &seed),
            nullifier: BytesN::from_array(&e, &seed),
            proof: Groth16Proof {
                a: BytesN::from_array(&e, &[0u8; 64]),
                b: BytesN::from_array(&e, &[0u8; 128]),
                c: BytesN::from_array(&e, &[0u8; 64]),
            },
            minted_at: pool.protocol_now(),
            status: NoteStatus::Active,
        };
        e.storage().persistent().set(&MockKey::Note(id), &note);
        pool.open_line(&note);
        id
    }

    /// Calls `open_line` again with an existing note (duplicate test).
    pub fn reopen(e: Env, id: u32) {
        let note = Self::get(e.clone(), id);
        PoolClient::new(&e, &Self::pool(&e)).open_line(&note);
    }

    pub fn get(e: Env, id: u32) -> Note {
        e.storage().persistent().get(&MockKey::Note(id)).unwrap()
    }

    /// Pool only, like the real contract.
    pub fn set_status(e: Env, id: u32, status: NoteStatus) {
        Self::pool(&e).require_auth();
        let mut note = Self::get(e.clone(), id);
        note.status = status;
        e.storage().persistent().set(&MockKey::Note(id), &note);
    }
}

impl MockNote {
    fn pool(e: &Env) -> Address {
        e.storage().instance().get(&MockKey::Pool).unwrap()
    }
}

// ---------------------------------------------------------------- setup

pub struct Ctx {
    pub e: Env,
    pub admin: Address,
    pub operator: Address,
    pub treasury: Address,
    pub card_settlement: Address,
    pub token: TeurcClient<'static>,
    pub notes: MockNoteClient<'static>,
    pub pool: AdvancePoolClient<'static>,
    refs: Cell<u32>,
}

impl Ctx {
    /// Deployed contracts, all auths mocked, nothing funded.
    pub fn bare(params: Params) -> Self {
        let e = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        e.ledger().set_timestamp(START);
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let operator = Address::generate(&e);
        let treasury = Address::generate(&e);
        let card_settlement = Address::generate(&e);
        let token_id = e.register(Teurc, (&admin,));
        let notes_id = e.register(MockNote, ());
        let pool_id = e.register(
            AdvancePool,
            (
                &admin,
                &operator,
                &treasury,
                &card_settlement,
                &token_id,
                &notes_id,
                params,
            ),
        );
        let notes = MockNoteClient::new(&e, &notes_id);
        notes.set_pool(&pool_id);
        let ctx = Ctx {
            token: TeurcClient::new(&e, &token_id),
            notes,
            pool: AdvancePoolClient::new(&e, &pool_id),
            e,
            admin,
            operator,
            treasury,
            card_settlement,
            refs: Cell::new(0),
        };
        ctx.fund(&ctx.treasury, 1_000_000 * EUR);
        ctx
    }

    /// Spec §7.4 wiring: treasury holds 1,000,000 tEURC and seeds the junior
    /// tranche with 10,000; one investor deposits `senior` into the vault.
    pub fn new(params: Params, senior: i128) -> Self {
        let ctx = Self::bare(params);
        ctx.pool.junior_deposit(&(10_000 * EUR));
        if senior > 0 {
            ctx.investor(senior);
        }
        ctx
    }

    pub fn fund(&self, to: &Address, amount: i128) {
        self.token.mint(to, &amount);
    }

    /// A new investor who deposits `amount` into the senior vault.
    pub fn investor(&self, amount: i128) -> Address {
        let investor = Address::generate(&self.e);
        self.fund(&investor, amount);
        self.pool.deposit(&amount, &investor, &investor, &investor);
        investor
    }

    /// A new agent with the card enabled.
    pub fn agent(&self) -> Address {
        let agent = Address::generate(&self.e);
        self.pool.enable_card(&agent);
        agent
    }

    pub fn today(&self) -> u32 {
        (self.pool.protocol_now() / DAY) as u32
    }

    /// Mints a note whose escritura is `days_ahead` protocol days away.
    pub fn note(&self, agent: &Address, total_commission: i128, days_ahead: u32) -> u32 {
        self.notes
            .mint(agent, &total_commission, &(self.today() + days_ahead))
    }

    /// A fresh, unique card authorization reference.
    pub fn auth_ref(&self) -> BytesN<32> {
        let n = self.refs.get() + 1;
        self.refs.set(n);
        let mut bytes = [0xAAu8; 32];
        bytes[..4].copy_from_slice(&n.to_be_bytes());
        BytesN::from_array(&self.e, &bytes)
    }

    pub fn draw(&self, agent: &Address, amount: i128) -> DrawResult {
        self.pool.card_draw(agent, &amount, &self.auth_ref())
    }

    pub fn stats(&self) -> PoolStats {
        self.pool.stats()
    }

    pub fn position(&self, agent: &Address) -> AgentPosition {
        self.pool.agent_position(agent)
    }

    pub fn advance_days(&self, days: u64) {
        self.pool.advance_clock(&(days * DAY));
    }

    /// Spec §5.3, exactly: senior + junior + fees == pool_cash + total_debt.
    pub fn assert_invariant(&self) {
        let s = self.stats();
        assert_eq!(
            s.senior_assets + s.junior_assets + s.fees_accrued,
            s.pool_cash + s.total_debt,
            "core invariant broken: {s:?}"
        );
        assert_eq!(
            s.pool_cash,
            self.token.balance(&self.pool.address) - s.total_card_balances
        );
    }
}

/// |a − b| ≤ tolerance.
#[track_caller]
pub fn assert_close(a: i128, b: i128, tolerance: i128) {
    assert!(
        (a - b).abs() <= tolerance,
        "{a} and {b} differ by {} (> {tolerance})",
        (a - b).abs()
    );
}
