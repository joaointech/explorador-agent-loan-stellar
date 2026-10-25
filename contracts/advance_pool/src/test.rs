#![cfg(test)]
extern crate std;

use crate::{AdvancePool, AdvancePoolClient, DrawResult, LineStatus, Params, PoolStats};
use advance_shared::{interfaces::PoolClient, Error, Groth16Proof, Note, NoteStatus};
use core::cell::Cell;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Events as _, Ledger, MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal,
};
use std::vec::Vec as StdVec;
use teurc::{Teurc, TeurcClient};

// ================================================================ mock note contract

#[contracttype]
enum MKey {
    Pool,
    Next,
    Note(u32),
}

/// Stand-in for `cpcv_note`: stores notes and opens lines as the note contract.
#[contract]
pub struct MockNote;

#[contractimpl]
impl MockNote {
    pub fn set_pool(e: Env, pool: Address) {
        e.storage().instance().set(&MKey::Pool, &pool);
    }

    pub fn add(e: Env, agent: Address, total_commission: i128, escritura_day: u32) -> u32 {
        let id: u32 = e.storage().instance().get(&MKey::Next).unwrap_or(1);
        e.storage().instance().set(&MKey::Next, &(id + 1));
        let agent_commission = total_commission / 2;
        let note = Note {
            id,
            agent: agent.clone(),
            total_commission,
            agent_commission,
            explorador_commission: total_commission - agent_commission,
            escritura_day,
            commitment: BytesN::from_array(&e, &[1; 32]),
            nullifier: BytesN::from_array(&e, &[2; 32]),
            proof: Groth16Proof {
                a: BytesN::from_array(&e, &[0; 64]),
                b: BytesN::from_array(&e, &[0; 128]),
                c: BytesN::from_array(&e, &[0; 64]),
            },
            minted_at: 0,
            status: NoteStatus::Active,
        };
        e.storage().persistent().set(&MKey::Note(id), &note);
        let pool: Address = e.storage().instance().get(&MKey::Pool).unwrap();
        PoolClient::new(&e, &pool).open_line(&id, &agent, &agent_commission, &escritura_day);
        id
    }

    pub fn get(e: Env, id: u32) -> Note {
        e.storage().persistent().get(&MKey::Note(id)).unwrap()
    }

    pub fn set_status(e: Env, id: u32, status: NoteStatus) {
        let pool: Address = e.storage().instance().get(&MKey::Pool).unwrap();
        pool.require_auth();
        let mut note: Note = e.storage().persistent().get(&MKey::Note(id)).unwrap();
        note.status = status;
        e.storage().persistent().set(&MKey::Note(id), &note);
    }
}

// ================================================================ harness

const T0: u64 = 1_760_000_000; // Oct 2025
const DAY: u64 = 86_400;
const EUR: i128 = 10_000_000;
const CENT: i128 = 100_000;

fn eur(x: i128) -> i128 {
    x * EUR
}

/// "€a.bc" helper: eur_c(88_77) = €88.77
fn eur_c(cents: i128) -> i128 {
    cents * CENT
}

fn default_params() -> Params {
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

macro_rules! res {
    ($call:expr) => {
        match $call {
            Ok(Ok(v)) => Ok(v),
            Err(Ok(err)) => Err(err),
            other => panic!("unexpected: {:?}", other),
        }
    };
}

fn assert_near(actual: i128, expected: i128, tol: i128, what: &str) {
    assert!(
        (actual - expected).abs() <= tol,
        "{what}: actual {actual} expected {expected} (diff {})",
        actual - expected
    );
}

struct T {
    e: Env,
    pool: AdvancePoolClient<'static>,
    note: MockNoteClient<'static>,
    token: TeurcClient<'static>,
    admin: Address,
    treasury: Address,
    card: Address,
    refs: Cell<u32>,
}

fn setup_with(params: Params, junior_seed: i128) -> T {
    let e = Env::default();
    e.mock_all_auths();
    e.cost_estimate().budget().reset_unlimited();
    e.ledger().set_timestamp(T0);
    let admin = Address::generate(&e);
    let operator = Address::generate(&e);
    let treasury = Address::generate(&e);
    let card = Address::generate(&e);
    let token_id = e.register(Teurc, (admin.clone(),));
    let note_id = e.register(MockNote, ());
    let pool_id = e.register(
        AdvancePool,
        (admin.clone(), operator, treasury.clone(), card.clone(), token_id.clone(), note_id.clone(), params),
    );
    let token = TeurcClient::new(&e, &token_id);
    let note = MockNoteClient::new(&e, &note_id);
    let pool = AdvancePoolClient::new(&e, &pool_id);
    note.set_pool(&pool_id);
    token.mint(&treasury, &eur(100_000_000));
    if junior_seed > 0 {
        pool.junior_deposit(&junior_seed);
    }
    T { e, pool, note, token, admin, treasury, card, refs: Cell::new(0) }
}

fn setup() -> T {
    setup_with(default_params(), eur(10_000))
}

impl T {
    fn investor(&self, amount: i128) -> Address {
        let a = Address::generate(&self.e);
        self.token.mint(&a, &amount);
        if amount > 0 {
            self.pool.deposit(&amount, &a, &a, &a);
        }
        a
    }

    fn agent(&self) -> Address {
        let a = Address::generate(&self.e);
        self.pool.enable_card(&a);
        a
    }

    fn today(&self) -> u32 {
        (self.pool.protocol_now() / DAY) as u32
    }

    fn new_note(&self, agent: &Address, total: i128, escritura_in_days: u32) -> u32 {
        self.note.add(agent, &total, &(self.today() + escritura_in_days))
    }

    fn next_ref(&self) -> BytesN<32> {
        let n = self.refs.get() + 1;
        self.refs.set(n);
        let mut b = [0u8; 32];
        b[..4].copy_from_slice(&n.to_be_bytes());
        BytesN::from_array(&self.e, &b)
    }

    fn draw(&self, agent: &Address, amount: i128) -> Result<DrawResult, Error> {
        let r = self.next_ref();
        res!(self.pool.try_card_draw(agent, &amount, &r))
    }

    /// Real (ledger) time passes.
    fn wait_days(&self, days: u64) {
        self.e.ledger().with_mut(|l| l.timestamp += days * DAY);
    }

    fn stats(&self) -> PoolStats {
        self.pool.stats()
    }

    /// (pool_cash + total_debt) − (senior + junior + fees)
    fn invariant_diff(&self) -> i128 {
        let s = self.stats();
        (s.pool_cash + s.total_debt) - (s.senior_assets + s.junior_assets + s.fees_accrued)
    }
}

// ================================================================ vault

#[test]
fn vault_deposit_withdraw_redeem_math() {
    let t = setup();
    let a = t.investor(eur(40_000));
    assert_eq!(t.pool.balance(&a), eur(40_000));
    let b = t.investor(eur(25_000));
    assert_eq!(t.pool.balance(&b), eur(25_000));
    assert_eq!(t.pool.total_supply(), eur(65_000));
    assert_eq!(t.pool.total_assets(), eur(65_000));
    assert_eq!(t.pool.preview_deposit(&eur(1_000)), eur(1_000));
    assert_eq!(t.pool.convert_to_assets(&eur(1_000)), eur(1_000));

    // Grow senior: €30,000 drawn for a year (single accrual) → 3,600 interest,
    // 360 fee, 3,240 net < 8% target (5,200) → all to senior.
    let agent = t.agent();
    t.new_note(&agent, eur(240_000), 400);
    t.draw(&agent, eur(30_000)).unwrap();
    t.wait_days(365);
    let s = t.stats();
    assert_near(s.senior_assets, eur(65_000 + 3_240), CENT, "senior after a year");
    assert_near(s.fees_accrued, eur(360), CENT, "fees after a year");
    assert_eq!(s.junior_assets, eur(10_000));
    let price = s.share_price_scaled;
    assert!(price > advance_shared::math::SCALE);

    // Donations cannot move the share price (accounting-based total_assets).
    t.token.mint(&t.pool.address, &eur(1_000));
    assert_eq!(t.stats().share_price_scaled, price);

    // A redeems everything: more than deposited.
    let max_a = t.pool.max_redeem(&a);
    assert_eq!(max_a, eur(40_000));
    let preview = t.pool.preview_redeem(&max_a);
    let before = t.token.balance(&a);
    let got = t.pool.redeem(&max_a, &a, &a, &a);
    assert_eq!(got, preview);
    assert_eq!(t.token.balance(&a) - before, got);
    assert!(got > eur(40_000));
    assert_near(got, eur(40_000) * (65_000 + 3_240) / 65_000, CENT, "A redemption");
    assert_eq!(t.pool.balance(&a), 0);

    // B is limited by available liquidity (no withdrawal queue).
    let s = t.stats();
    let b_value = t.pool.convert_to_assets(&t.pool.balance(&b));
    let max_b = t.pool.max_withdraw(&b);
    assert_eq!(max_b, b_value.min(s.lendable));
    assert!(max_b < b_value, "liquidity should bind for B");
    assert_eq!(res!(t.pool.try_withdraw(&(max_b + 1), &b, &b, &b)), Err(Error::ExceedsMaximum));
    let shares_needed = t.pool.preview_withdraw(&max_b);
    let shares_before = t.pool.balance(&b);
    let burned = t.pool.withdraw(&max_b, &b, &b, &b);
    assert_eq!(burned, shares_needed);
    assert_eq!(t.pool.balance(&b), shares_before - burned);
    assert_eq!(t.pool.max_withdraw(&b), 0);

    // mint(shares) rounds assets up.
    let c = Address::generate(&t.e);
    t.token.mint(&c, &eur(10_000));
    let want = eur(1_000);
    let need = t.pool.preview_mint(&want);
    let paid = t.pool.mint(&want, &c, &c, &c);
    assert_eq!(paid, need);
    assert!(paid >= t.pool.convert_to_assets(&want));
    assert_eq!(t.pool.balance(&c), want);
    assert_eq!(t.token.balance(&c), eur(10_000) - paid);

    // Allowance-based redeem: C lets D redeem on its behalf.
    let d = Address::generate(&t.e);
    t.pool.approve(&c, &d, &eur(500), &1_000);
    let out = t.pool.redeem(&eur(500), &d, &c, &d);
    assert!(out > 0);
    assert_eq!(t.pool.allowance(&c, &d), 0);
    assert_eq!(t.token.balance(&d), out);

    // SEP-41 share transfers and burn keep the supply exact.
    let supply = t.pool.total_supply();
    t.pool.transfer(&c, &d, &eur(100));
    assert_eq!(t.pool.balance(&d), eur(100));
    t.pool.burn(&d, &eur(100));
    assert_eq!(t.pool.total_supply(), supply - eur(100));
    assert_eq!(t.pool.symbol(), soroban_sdk::String::from_str(&t.e, "eaSR"));
    assert_eq!(t.pool.decimals(), 7);
    assert!(t.invariant_diff() >= 0);
}

#[test]
fn deposit_rejects_zero() {
    let t = setup();
    let a = Address::generate(&t.e);
    t.token.mint(&a, &eur(1));
    assert_eq!(res!(t.pool.try_deposit(&0, &a, &a, &a)), Err(Error::InvalidAmount));
}

// ================================================================ worked example (§5.6)

struct Example {
    t: T,
    agent: Address,
    note: u32,
}

fn worked_example() -> Example {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    // €300,000 at 5% → €15,000 total commission.
    let note = t.new_note(&agent, eur(15_000), 90);
    let lv = t.pool.line(&note);
    assert_eq!(lv.line.credit_limit, eur(3_750));
    let r = t.draw(&agent, eur(3_000)).unwrap();
    assert_eq!(r, DrawResult { from_balance: 0, from_credit: eur(3_000) });
    assert_eq!(t.token.balance(&t.card), eur(3_000));
    Example { t, agent, note }
}

#[test]
fn worked_example_single_accrual() {
    let Example { t, agent, note } = worked_example();
    t.wait_days(90); // no other pool activity → one accrual at settlement
    let pos = t.pool.agent_position(&agent);
    assert_near(pos.total_debt, eur_c(3_088_77), CENT, "debt at escritura");
    let s0 = t.pool.stats();
    assert_eq!(s0.junior_assets, eur(10_000));

    t.pool.settle(&note);
    let s = t.stats();
    let pos = t.pool.agent_position(&agent);
    assert_eq!(pos.total_debt, 0);
    assert_eq!(pos.lines.len(), 0);
    assert_near(pos.card_balance, eur_c(4_411_23), CENT, "agent payout");
    assert_eq!(s.junior_assets, eur(10_000 + 7_500)); // senior target not reached → junior gets no interest
    assert_near(s.fees_accrued, eur_c(8_88), CENT, "protocol fee");
    assert_near(s.senior_assets, eur(100_000) + eur_c(79_89), CENT, "senior interest");
    assert_near(s.senior_assets - eur(100_000) + s.fees_accrued, eur_c(88_77), CENT, "interest");
    assert_eq!(s.total_card_balances, pos.card_balance);
    assert_eq!(t.note.get(&note).status, NoteStatus::Settled);
    assert_eq!(t.pool.line(&note).line.status, LineStatus::Settled);
    assert!(s.share_price_scaled > advance_shared::math::SCALE);
    let diff = t.invariant_diff();
    assert!((0..=10).contains(&diff), "invariant dust {diff}");
}

#[test]
fn worked_example_daily_accruals() {
    let Example { t, agent, note } = worked_example();
    for _ in 0..90 {
        t.wait_days(1);
        t.pool.accrue();
    }
    let pos = t.pool.agent_position(&agent);
    assert_near(pos.total_debt - eur(3_000), eur_c(90_08), 2 * CENT, "compounded interest");
    t.pool.settle(&note);
    let pos = t.pool.agent_position(&agent);
    assert_near(pos.card_balance, eur(7_500) - eur_c(3_090_08), 2 * CENT, "payout");
}

#[test]
fn settle_event_fields() {
    use soroban_sdk::Event;
    let Example { t, agent, note } = worked_example();
    t.wait_days(90);
    let d = t.pool.agent_position(&agent).total_debt;
    t.pool.settle(&note);
    let expected = crate::events::NoteSettled {
        note_id: note,
        agent: agent.clone(),
        total_commission: eur(15_000),
        debt_repaid: d,
        interest_paid: d - eur(3_000),
        carried_repaid: 0,
        agent_payout: eur(7_500) - d,
        junior_deposit: eur(7_500),
    }
    .to_xdr(&t.e, &t.pool.address);
    let events = t.e.events().all().filter_by_contract(&t.pool.address);
    assert!(events.events().contains(&expected), "NoteSettled event not found");
}

// ================================================================ yield / loss illustrations (§5.6)

fn yield_case(debt_eur: i128) -> PoolStats {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    t.new_note(&agent, eur(360_000), 399); // limit €90,000
    t.draw(&agent, eur(debt_eur)).unwrap();
    t.wait_days(365);
    t.pool.accrue();
    t.stats()
}

#[test]
fn yield_illustration_60k() {
    let s = yield_case(60_000);
    // 7,200 interest − 720 fee = 6,480 → all to senior (6.48%), junior 0.
    assert_near(s.senior_assets, eur(106_480), CENT, "senior");
    assert_eq!(s.junior_assets, eur(10_000));
    assert_near(s.fees_accrued, eur(720), CENT, "fees");
}

#[test]
fn yield_illustration_90k() {
    let s = yield_case(90_000);
    // 10,800 − 1,080 = 9,720 → senior 8,000 (8%), junior 1,720 (17.2%).
    assert_near(s.senior_assets, eur(108_000), CENT, "senior");
    assert_near(s.junior_assets, eur(11_720), CENT, "junior");
}

#[test]
fn loss_illustration_junior_absorbs() {
    let mut p = default_params();
    p.grace_period_secs = 0;
    let t = setup_with(p, eur(10_000));
    t.investor(eur(100_000));
    let agent = t.agent();
    let note = t.new_note(&agent, eur(15_000), 90);
    t.draw(&agent, eur(2_000)).unwrap();
    t.pool.cancel(&note);
    let senior = t.stats().senior_assets;
    t.pool.write_off(&agent);
    let s = t.stats();
    assert_eq!(s.junior_assets, eur(8_000));
    assert_eq!(s.senior_assets, senior);
    assert_eq!(s.written_off_total, eur(2_000));
    assert_eq!(s.total_debt, 0);
}

// ================================================================ card draws

#[test]
fn draw_order_balance_first_then_earliest_escritura() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    let late = t.new_note(&agent, eur(15_000), 60); // limit 3,750
    let early = t.new_note(&agent, eur(10_000), 30); // limit 2,500
    // A settled €2,000 deal with no debt → €1,000 card balance.
    let paid = t.new_note(&agent, eur(2_000), 10);
    t.pool.settle(&paid);
    assert_eq!(t.pool.agent_position(&agent).card_balance, eur(1_000));

    let r = t.draw(&agent, eur(3_000)).unwrap();
    assert_eq!(r, DrawResult { from_balance: eur(1_000), from_credit: eur(2_000) });
    assert_eq!(t.pool.line(&early).line.principal, eur(2_000));
    assert_eq!(t.pool.line(&late).line.principal, 0);

    let r = t.draw(&agent, eur(1_000)).unwrap();
    assert_eq!(r, DrawResult { from_balance: 0, from_credit: eur(1_000) });
    assert_eq!(t.pool.line(&early).line.principal, eur(2_500));
    assert_eq!(t.pool.line(&late).line.principal, eur(500));
    assert_eq!(t.token.balance(&t.card), eur(4_000));
    let pos = t.pool.agent_position(&agent);
    assert_eq!(pos.card_balance, 0);
    assert_eq!(pos.available_credit, eur(3_250));
}

#[test]
fn credit_limit_enforced() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    t.new_note(&agent, eur(15_000), 90);
    assert_eq!(t.draw(&agent, eur(3_750) + 1), Err(Error::InsufficientCredit));
    t.draw(&agent, eur(3_750)).unwrap();
    assert_eq!(t.draw(&agent, 1), Err(Error::InsufficientCredit));
    assert_eq!(t.pool.agent_position(&agent).borrowable_now, 0);
}

#[test]
fn agent_without_notes_has_no_credit() {
    let t = setup();
    let agent = t.agent();
    let pos = t.pool.agent_position(&agent);
    assert_eq!(pos.available_credit, 0);
    assert_eq!(t.draw(&agent, eur(1)), Err(Error::InsufficientCredit));
}

#[test]
fn leverage_cap_enforced() {
    let t = setup(); // junior €10,000 → debt ≤ €100,000
    t.investor(eur(200_000));
    let agent = t.agent();
    t.new_note(&agent, eur(600_000), 90); // limit €150,000
    assert_eq!(t.stats().leverage_headroom, eur(100_000));
    assert_eq!(t.draw(&agent, eur(100_000) + 1), Err(Error::LeverageCapExceeded));
    t.draw(&agent, eur(100_000)).unwrap();
    let s = t.stats();
    assert_eq!(s.leverage_x100, 1_000);
    assert_eq!(s.leverage_headroom, 0);
    // The cap also limits junior withdrawals.
    assert_eq!(res!(t.pool.try_junior_withdraw(&eur(1))), Err(Error::LeverageCapExceeded));
}

#[test]
fn liquidity_cap_enforced() {
    let t = setup(); // only the €10,000 junior seed is in the pool
    let agent = t.agent();
    t.new_note(&agent, eur(100_000), 90); // limit €25,000
    assert_eq!(t.stats().lendable, eur(10_000));
    assert_eq!(t.draw(&agent, eur(10_000) + 1), Err(Error::InsufficientLiquidity));
    t.draw(&agent, eur(10_000)).unwrap();
    assert_eq!(t.stats().lendable, 0);
    // An investor who joins now can only take back what is liquid.
    let inv = t.investor(eur(5_000));
    t.draw(&agent, eur(5_000)).unwrap();
    assert_eq!(t.pool.max_withdraw(&inv), 0);
    assert_eq!(t.pool.max_redeem(&inv), 0);
    assert_eq!(res!(t.pool.try_withdraw(&eur(1), &inv, &inv, &inv)), Err(Error::ExceedsMaximum));
}

#[test]
fn duplicate_auth_ref_rejected() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    t.new_note(&agent, eur(15_000), 90);
    let r = BytesN::from_array(&t.e, &[7; 32]);
    t.pool.card_draw(&agent, &eur(10), &r);
    assert!(t.pool.draw_used(&r));
    assert_eq!(res!(t.pool.try_card_draw(&agent, &eur(10), &r)), Err(Error::DuplicateDraw));
}

#[test]
fn card_must_be_enabled() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = Address::generate(&t.e);
    t.new_note(&agent, eur(15_000), 90);
    assert_eq!(t.draw(&agent, eur(10)), Err(Error::CardNotEnabled));
    t.pool.enable_card(&agent);
    t.draw(&agent, eur(10)).unwrap();
    t.pool.disable_card(&agent);
    assert_eq!(t.draw(&agent, eur(10)), Err(Error::CardNotEnabled));
}

#[test]
fn blocked_agent_cannot_borrow_but_can_spend_balance() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    t.new_note(&agent, eur(15_000), 90);
    let paid = t.new_note(&agent, eur(2_000), 10);
    t.pool.settle(&paid); // €1,000 card balance
    t.pool.set_blocked(&agent, &true);
    let pos = t.pool.agent_position(&agent);
    assert!(pos.blocked);
    assert_eq!(pos.available_credit, 0);
    assert_eq!(t.draw(&agent, eur(1_000) + 1), Err(Error::AgentBlocked));
    t.draw(&agent, eur(1_000)).unwrap();
    t.pool.set_blocked(&agent, &false);
    t.draw(&agent, eur(100)).unwrap();
}

#[test]
fn withdraw_balance_to_account() {
    let t = setup();
    let agent = t.agent();
    let paid = t.new_note(&agent, eur(2_000), 10);
    t.pool.settle(&paid);
    let to = Address::generate(&t.e);
    assert_eq!(
        res!(t.pool.try_withdraw_balance(&agent, &(eur(1_000) + 1), &to)),
        Err(Error::InsufficientBalance)
    );
    t.pool.withdraw_balance(&agent, &eur(400), &to);
    assert_eq!(t.token.balance(&to), eur(400));
    assert_eq!(t.pool.agent_position(&agent).card_balance, eur(600));
    assert_eq!(t.stats().total_card_balances, eur(600));
}

// ================================================================ settlement variants

#[test]
fn settle_repays_carried_debt_first() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    let lost = t.new_note(&agent, eur(15_000), 90);
    let good = t.new_note(&agent, eur(15_000), 120);
    t.draw(&agent, eur(2_000)).unwrap(); // on `lost` (earlier escritura)
    assert_eq!(t.pool.line(&lost).line.principal, eur(2_000));
    t.pool.cancel(&lost);
    let pos = t.pool.agent_position(&agent);
    assert_eq!(pos.carried_debt, eur(2_000));
    assert_eq!(pos.grace_deadline, Some(T0 + 180 * DAY));
    // Carried debt reduces the remaining line's availability.
    assert_eq!(pos.available_credit, eur(3_750) - eur(2_000));
    assert_eq!(t.note.get(&lost).status, NoteStatus::Cancelled);
    assert_eq!(res!(t.pool.try_settle(&lost)), Err(Error::LineNotActive));

    t.pool.settle(&good);
    let pos = t.pool.agent_position(&agent);
    assert_eq!(pos.carried_debt, 0);
    assert_eq!(pos.grace_deadline, None);
    assert_eq!(pos.card_balance, eur(5_500));
    assert_eq!(t.stats().total_debt, 0);
}

#[test]
fn cancel_uses_card_balance_immediately() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    let lost = t.new_note(&agent, eur(15_000), 90);
    let paid = t.new_note(&agent, eur(2_000), 120);
    t.draw(&agent, eur(2_000)).unwrap();
    t.pool.settle(&paid); // €1,000 balance
    t.pool.cancel(&lost);
    let pos = t.pool.agent_position(&agent);
    assert_eq!(pos.card_balance, 0);
    assert_near(pos.carried_debt, eur(1_000), 2, "carried after balance repay");
    assert!(pos.grace_deadline.is_some());
    assert_eq!(t.stats().total_card_balances, 0);
}

#[test]
fn settle_when_debt_exceeds_agent_half() {
    let mut p = default_params();
    p.ltv_bps = 10_000; // 100% of the agent half, so interest pushes debt past it
    let t = setup_with(p, eur(10_000));
    t.investor(eur(100_000));
    let agent = t.agent();
    let note = t.new_note(&agent, eur(2_000), 60); // agent half €1,000, limit €1,000
    t.draw(&agent, eur(1_000)).unwrap();
    t.wait_days(30);
    let debt = t.pool.agent_position(&agent).total_debt;
    assert!(debt > eur(1_000));
    let junior = t.stats().junior_assets;
    t.pool.settle(&note);
    let pos = t.pool.agent_position(&agent);
    assert_eq!(pos.card_balance, 0);
    assert_near(pos.carried_debt, debt - eur(1_000), 2, "shortfall carried");
    assert_eq!(pos.grace_deadline, Some(t.pool.protocol_now() + 180 * DAY));
    assert_eq!(t.stats().junior_assets, junior + eur(1_000));
    assert_eq!(t.note.get(&note).status, NoteStatus::Settled);
}

#[test]
fn settle_requires_active_line() {
    let t = setup();
    let agent = t.agent();
    let note = t.new_note(&agent, eur(2_000), 10);
    t.pool.settle(&note);
    assert_eq!(res!(t.pool.try_settle(&note)), Err(Error::LineNotActive));
    assert_eq!(res!(t.pool.try_settle(&99)), Err(Error::UnknownNote));
}

// ================================================================ cancel → grace → write-off

#[test]
fn cancel_grace_write_off_junior_first() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    let note = t.new_note(&agent, eur(15_000), 90);
    t.draw(&agent, eur(2_000)).unwrap();
    assert_eq!(res!(t.pool.try_write_off(&agent)), Err(Error::NothingToWriteOff));
    t.pool.cancel(&note);
    assert_eq!(res!(t.pool.try_write_off(&agent)), Err(Error::GraceNotOver));
    t.wait_days(179);
    assert_eq!(res!(t.pool.try_write_off(&agent)), Err(Error::GraceNotOver));
    t.wait_days(1);
    let before = t.stats();
    let carried = t.pool.agent_position(&agent).carried_debt;
    assert!(carried > eur(2_000), "interest keeps running in grace");
    t.pool.write_off(&agent);
    let after = t.stats();
    assert_eq!(after.junior_assets, before.junior_assets - carried);
    assert_eq!(after.senior_assets, before.senior_assets);
    assert_eq!(after.written_off_total, carried);
    assert_eq!(after.total_debt, 0);
    let pos = t.pool.agent_position(&agent);
    assert!(pos.blocked);
    assert_eq!(pos.carried_debt, 0);
    assert_eq!(pos.grace_deadline, None);
    assert_eq!(t.pool.agent_state(&agent).written_off_total, carried);
    // Blocked from new credit.
    t.new_note(&agent, eur(15_000), 90);
    assert_eq!(t.draw(&agent, eur(1)), Err(Error::AgentBlocked));
    let d = t.invariant_diff();
    assert!((0..=10).contains(&d), "invariant dust {d}");
}

#[test]
fn write_off_hits_senior_only_after_junior_exhausted() {
    let mut p = default_params();
    p.grace_period_secs = 0;
    let t = setup_with(p, eur(1_000));
    let inv = t.investor(eur(50_000));
    let agent = t.agent();
    let note = t.new_note(&agent, eur(15_000), 90);
    t.draw(&agent, eur(2_000)).unwrap();
    t.pool.cancel(&note);
    let price_before = t.stats().share_price_scaled;
    t.pool.write_off(&agent);
    let s = t.stats();
    assert_eq!(s.junior_assets, 0);
    assert_eq!(s.senior_assets, eur(49_000));
    assert!(s.share_price_scaled < price_before);
    assert_near(t.pool.convert_to_assets(&t.pool.balance(&inv)), eur(49_000), 2, "investor value");
}

// ================================================================ junior & fees

#[test]
fn junior_and_fee_limits() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    let note = t.new_note(&agent, eur(15_000), 90);
    t.draw(&agent, eur(3_000)).unwrap();
    t.wait_days(90);
    t.pool.settle(&note);
    let s = t.stats();
    assert!(s.fees_accrued > 0);
    assert_eq!(res!(t.pool.try_claim_fees(&(s.fees_accrued + 1))), Err(Error::ExceedsMaximum));
    let before = t.token.balance(&t.treasury);
    t.pool.claim_fees(&s.fees_accrued);
    assert_eq!(t.token.balance(&t.treasury) - before, s.fees_accrued);
    assert_eq!(t.stats().fees_accrued, 0);

    assert_eq!(res!(t.pool.try_junior_withdraw(&(s.junior_assets + 1))), Err(Error::ExceedsMaximum));
    t.pool.junior_withdraw(&eur(7_500));
    assert_eq!(t.stats().junior_assets, s.junior_assets - eur(7_500));
    t.pool.junior_deposit(&eur(500));
    assert_eq!(t.stats().junior_assets, s.junior_assets - eur(7_000));
}

// ================================================================ protocol clock

#[test]
fn advance_clock_requires_demo_mode() {
    let mut p = default_params();
    p.demo_mode = false;
    let t = setup_with(p, eur(10_000));
    assert_eq!(res!(t.pool.try_advance_clock(&DAY)), Err(Error::DemoModeDisabled));
}

#[test]
fn advance_clock_admin_only() {
    let t = setup();
    let stranger = Address::generate(&t.e);
    t.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &t.pool.address,
            fn_name: "advance_clock",
            args: (DAY,).into_val(&t.e),
            sub_invokes: &[],
        },
    }]);
    assert!(t.pool.try_advance_clock(&DAY).is_err());
    assert_eq!(t.pool.demo_offset(), 0);
    t.e.mock_all_auths();
    t.pool.advance_clock(&DAY);
    assert_eq!(t.pool.demo_offset(), DAY);
    let _ = &t.admin;
}

#[test]
fn advance_clock_is_monotonic_and_bounded() {
    let t = setup();
    let now0 = t.pool.protocol_now();
    assert_eq!(res!(t.pool.try_advance_clock(&0)), Err(Error::InvalidAmount));
    assert_eq!(res!(t.pool.try_advance_clock(&(400 * DAY + 1))), Err(Error::ClockAdvanceTooLarge));
    let now1 = t.pool.advance_clock(&(30 * DAY));
    assert_eq!(now1, now0 + 30 * DAY);
    t.pool.advance_clock(&(400 * DAY));
    assert_eq!(t.pool.protocol_now(), now0 + 430 * DAY);
    assert_eq!(t.pool.demo_offset(), 430 * DAY);
}

#[test]
fn advance_clock_accrues_first() {
    let t = setup();
    t.investor(eur(100_000));
    let agent = t.agent();
    t.new_note(&agent, eur(15_000), 200);
    t.draw(&agent, eur(3_000)).unwrap();
    t.wait_days(10); // real time
    t.pool.advance_clock(&(80 * DAY)); // accrues the 10 days, then jumps 80
    let debt = t.pool.agent_position(&agent).total_debt;
    // Two accrual periods compound: 3000 × (1 + r·10/365) × (1 + r·80/365).
    let r = 0.12f64;
    let expected = 3000.0 * (1.0 + r * 10.0 / 365.0) * (1.0 + r * 80.0 / 365.0);
    let expected = (expected * EUR as f64) as i128;
    assert_near(debt, expected, CENT, "compounded debt");
    let single = eur(3_000) + eur(3_000) * 1200 * 90 / (10_000 * 365);
    assert!(debt > single + 20 * CENT);
    // The jump is immediately visible in views and the grace clock.
    assert_eq!(t.today() as u64, (T0 + 90 * DAY) / DAY);
}

#[test]
fn open_line_only_from_note_contract() {
    let t = setup();
    let agent = Address::generate(&t.e);
    let stranger = Address::generate(&t.e);
    t.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &t.pool.address,
            fn_name: "open_line",
            args: (5u32, agent.clone(), eur(1_000), 30_000u32).into_val(&t.e),
            sub_invokes: &[],
        },
    }]);
    assert!(t.pool.try_open_line(&5, &agent, &eur(1_000), &30_000).is_err());
}

// ================================================================ invariant fuzz (§5.3)

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn range(&mut self, lo: i128, hi: i128) -> i128 {
        lo + (self.next() as i128).rem_euclid(hi - lo + 1)
    }
}

#[test]
fn invariant_fuzz() {
    let mut p = default_params();
    p.grace_period_secs = 30 * DAY; // short grace so write-offs happen during the run
    let t = setup_with(p, eur(10_000));
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let investors: StdVec<Address> = (0..3)
        .map(|_| {
            let a = Address::generate(&t.e);
            t.token.mint(&a, &eur(5_000_000));
            a
        })
        .collect();
    let agents: StdVec<Address> = (0..4).map(|_| t.agent()).collect();
    let mut active: StdVec<u32> = StdVec::new();
    // agents[3]'s deals always fall through (never settled), so write-offs happen.
    let mut doomed: StdVec<u32> = StdVec::new();
    let mut ops = 0u32;
    let mut counts = [0u32; 13];
    let (mut min_d, mut max_d) = (i128::MAX, i128::MIN);

    for i in 0..800u32 {
        let op = rng.below(13) as usize;
        let ok = match op {
            0 => {
                let inv = &investors[rng.below(3) as usize];
                let amt = rng.range(eur(100), eur(30_000));
                res!(t.pool.try_deposit(&amt, inv, inv, inv)).is_ok()
            }
            1 => {
                let inv = &investors[rng.below(3) as usize];
                let max = t.pool.max_redeem(inv);
                max > 1 && res!(t.pool.try_redeem(&rng.range(1, max), inv, inv, inv)).is_ok()
            }
            2 => {
                let inv = &investors[rng.below(3) as usize];
                let max = t.pool.max_withdraw(inv);
                max > 1 && res!(t.pool.try_withdraw(&rng.range(1, max), inv, inv, inv)).is_ok()
            }
            3 => {
                let k = rng.below(4) as usize;
                let total = rng.range(eur(2_000), eur(40_000));
                let id = t.new_note(&agents[k], total, rng.range(20, 200) as u32);
                if k == 3 {
                    doomed.push(id);
                } else {
                    active.push(id);
                }
                true
            }
            4 | 5 => {
                let ag = &agents[rng.below(4) as usize];
                t.draw(ag, rng.range(CENT, eur(6_000))).is_ok()
            }
            6 => {
                let days = rng.below(20);
                if days > 0 {
                    if rng.below(2) == 0 {
                        t.wait_days(days);
                    } else {
                        t.pool.advance_clock(&(days * DAY));
                    }
                }
                true
            }
            7 if !active.is_empty() => {
                let id = active.swap_remove(rng.below(active.len() as u64) as usize);
                res!(t.pool.try_settle(&id)).is_ok()
            }
            8 if !doomed.is_empty() => {
                let id = doomed.swap_remove(rng.below(doomed.len() as u64) as usize);
                res!(t.pool.try_cancel(&id)).is_ok()
            }
            8 if !active.is_empty() && rng.below(3) == 0 => {
                let id = active.swap_remove(rng.below(active.len() as u64) as usize);
                res!(t.pool.try_cancel(&id)).is_ok()
            }
            9 => {
                let ag = &agents[rng.below(4) as usize];
                res!(t.pool.try_write_off(ag)).is_ok()
            }
            10 => {
                let ag = &agents[rng.below(4) as usize];
                let bal = t.pool.agent_position(ag).card_balance;
                bal > 0 && res!(t.pool.try_withdraw_balance(ag, &rng.range(1, bal), ag)).is_ok()
            }
            11 => match rng.below(3) {
                0 => res!(t.pool.try_junior_deposit(&rng.range(eur(10), eur(5_000)))).is_ok(),
                1 => res!(t.pool.try_junior_withdraw(&rng.range(eur(10), eur(3_000)))).is_ok(),
                _ => {
                    let fees = t.stats().fees_accrued;
                    fees > 0 && res!(t.pool.try_claim_fees(&rng.range(1, fees))).is_ok()
                }
            },
            12 => {
                t.pool.accrue();
                true
            }
            _ => false,
        };
        if ok {
            ops += 1;
            counts[op] += 1;
        }
        let d = t.invariant_diff();
        min_d = min_d.min(d);
        max_d = max_d.max(d);
        assert!(d >= 0 && d <= 1_000, "invariant broken after op {i} (kind {op}): diff {d}");

        // Card balances are fully accounted for.
        let sum: i128 = agents.iter().map(|a| t.pool.agent_position(a).card_balance).sum();
        assert_eq!(sum, t.stats().total_card_balances);
    }
    std::println!("fuzz: {ops} successful ops, per kind {counts:?}, invariant dust range [{min_d}, {max_d}] stroops");
    assert!(ops >= 500, "only {ops} successful ops");
    assert!(counts[4] + counts[5] > 50 && counts[7] > 10 && counts[8] > 5 && counts[9] > 0, "{counts:?}");
}

#[test]
fn settle_with_shared_operator_treasury_key() {
    // The demo may run operator and treasury on one account: a single auth
    // entry for `settle` (with the token pull as a sub-invocation) must suffice.
    let e = Env::default();
    e.mock_all_auths();
    e.cost_estimate().budget().reset_unlimited();
    e.ledger().set_timestamp(T0);
    let admin = Address::generate(&e);
    let ops = Address::generate(&e);
    let card = Address::generate(&e);
    let token_id = e.register(Teurc, (admin.clone(),));
    let note_id = e.register(MockNote, ());
    let pool_id = e.register(
        AdvancePool,
        (admin.clone(), ops.clone(), ops.clone(), card, token_id.clone(), note_id.clone(), default_params()),
    );
    let token = TeurcClient::new(&e, &token_id);
    let note = MockNoteClient::new(&e, &note_id);
    let pool = AdvancePoolClient::new(&e, &pool_id);
    note.set_pool(&pool_id);
    token.mint(&ops, &eur(1_000_000));
    pool.junior_deposit(&eur(10_000));
    let agent = Address::generate(&e);
    pool.enable_card(&agent);
    let id = note.add(&agent, &eur(15_000), &((T0 / DAY) as u32 + 90));

    e.mock_auths(&[MockAuth {
        address: &ops,
        invoke: &MockAuthInvoke {
            contract: &pool_id,
            fn_name: "settle",
            args: (id,).into_val(&e),
            sub_invokes: &[MockAuthInvoke {
                contract: &token_id,
                fn_name: "transfer",
                args: (ops.clone(), pool_id.clone(), eur(15_000)).into_val(&e),
                sub_invokes: &[],
            }],
        },
    }]);
    pool.settle(&id);
    assert_eq!(pool.agent_position(&agent).card_balance, eur(7_500));
}
