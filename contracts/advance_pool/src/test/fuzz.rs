//! Invariant fuzz test (spec §5.3, §12.1): long random operation sequences,
//! checking after every operation that
//! `senior + junior + fees == pool_cash + total_debt` (exactly) together with
//! the per-agent and share bookkeeping.

use core::fmt::Debug;

use advance_shared::Error;
use soroban_sdk::BytesN;

use super::*;
use crate::LineStatus;

/// Operations per seed (spec: at least 500).
const OPS: usize = 600;
/// One pool shape per seed, so that every limit gets hit somewhere.
struct Run {
    seed: u64,
    ltv_bps: u32,
    /// Initial junior tranche.
    junior: i128,
    /// Initial deposit of each of the three investors.
    senior: i128,
    /// Largest random deposit.
    deposit_max: i128,
}

const RUNS: [Run; 3] = [
    // Balanced pool.
    Run {
        seed: 0x5EED_0001,
        ltv_bps: 5_000,
        junior: 10_000 * EUR,
        senior: 20_000 * EUR,
        deposit_max: 15_000 * EUR,
    },
    // Thin junior: the leverage cap binds; LTV 100% lets interest push debts
    // above the agent's half (settlement shortfalls).
    Run {
        seed: 0x00C0_FFEE,
        ltv_bps: 10_000,
        junior: 2_000 * EUR,
        senior: 40_000 * EUR,
        deposit_max: 15_000 * EUR,
    },
    // Thick junior, little senior: liquidity binds.
    Run {
        seed: 0xDEAD_BEEF_1234,
        ltv_bps: 5_000,
        junior: 30_000 * EUR,
        senior: 2_000 * EUR,
        deposit_max: 2_000 * EUR,
    },
];

/// xorshift64* — deterministic, so failures reproduce.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }

    /// A positive amount ≤ `max` stroops: whole euros, cents or odd stroops.
    fn amount(&mut self, max: i128) -> i128 {
        let max = max.max(1);
        let raw = 1 + self.below(max as u64) as i128;
        let shaped = match self.below(3) {
            0 => (raw / EUR).max(1) * EUR,
            1 => (raw / CENT).max(1) * CENT,
            _ => raw,
        };
        shaped.min(max)
    }

    fn pick<T: Clone>(&mut self, items: &[T]) -> T {
        items[self.below(items.len() as u64) as usize].clone()
    }
}

#[derive(Default, Debug)]
struct Counts {
    deposits: u32,
    withdrawals: u32,
    notes: u32,
    draws: u32,
    duplicate_draws: u32,
    rejected_draws: u32,
    /// Rejections by reason: credit, liquidity, leverage, card off, blocked.
    rejections: [u32; 5],
    settles: u32,
    shortfall_settles: u32,
    cancels: u32,
    write_offs: u32,
    fee_claims: u32,
    clock_moves: u32,
}

/// Ok → Some; an allowed contract error → None; anything else fails the test.
#[track_caller]
fn outcome<T, C: Debug, I: Debug>(
    result: Result<Result<T, C>, Result<Error, I>>,
    allowed: &[Error],
) -> Option<T> {
    match result {
        Ok(Ok(value)) => Some(value),
        Err(Ok(error)) if allowed.contains(&error) => None,
        Err(Ok(error)) => panic!("unexpected contract error {error:?}"),
        Err(Err(invoke)) => panic!("host failure {invoke:?}"),
        Ok(Err(conversion)) => panic!("conversion failure {conversion:?}"),
    }
}

#[test]
fn invariant_holds_over_random_operations() {
    let mut total = Counts::default();
    for r in &RUNS {
        let c = run(r);
        total.deposits += c.deposits;
        total.withdrawals += c.withdrawals;
        total.notes += c.notes;
        total.draws += c.draws;
        total.duplicate_draws += c.duplicate_draws;
        total.rejected_draws += c.rejected_draws;
        for (t, r) in total.rejections.iter_mut().zip(c.rejections) {
            *t += r;
        }
        total.settles += c.settles;
        total.shortfall_settles += c.shortfall_settles;
        total.cancels += c.cancels;
        total.write_offs += c.write_offs;
        total.fee_claims += c.fee_claims;
        total.clock_moves += c.clock_moves;
    }
    std::println!("fuzz coverage over {} ops: {total:?}", OPS * RUNS.len());
    // Every path of interest was exercised.
    assert!(total.deposits >= 30 && total.withdrawals >= 30, "{total:?}");
    assert!(total.notes >= 50 && total.draws >= 100, "{total:?}");
    assert!(
        total.duplicate_draws >= 3 && total.rejected_draws >= 10,
        "{total:?}"
    );
    assert!(total.rejections.iter().all(|r| *r > 0), "{total:?}");
    assert!(total.settles >= 20 && total.cancels >= 10, "{total:?}");
    assert!(total.shortfall_settles >= 1, "{total:?}");
    assert!(total.write_offs >= 3 && total.fee_claims >= 5, "{total:?}");
    assert!(total.clock_moves >= 30, "{total:?}");
}

fn run(r: &Run) -> Counts {
    let ctx = Ctx::bare(Params {
        ltv_bps: r.ltv_bps,
        ..default_params()
    });
    let mut rng = Rng(r.seed);
    let mut c = Counts::default();
    ctx.fund(&ctx.treasury, 100_000_000 * EUR);
    ctx.pool.junior_deposit(&r.junior);
    let investors: std::vec::Vec<Address> = (0..3)
        .map(|_| {
            let investor = Address::generate(&ctx.e);
            ctx.fund(&investor, 100_000_000 * EUR);
            ctx.pool.deposit(&r.senior, &investor, &investor, &investor);
            investor
        })
        .collect();
    let agents: std::vec::Vec<Address> = (0..4).map(|_| ctx.agent()).collect();
    let mut notes: std::vec::Vec<u32> = std::vec::Vec::new();
    let mut refs: std::vec::Vec<BytesN<32>> = std::vec::Vec::new();
    check(&ctx, &investors, &agents);

    for _ in 0..OPS {
        match rng.below(100) {
            // ---- senior vault
            0..=5 => {
                let investor = rng.pick(&investors);
                let assets = rng.amount(r.deposit_max);
                let r = ctx
                    .pool
                    .try_deposit(&assets, &investor, &investor, &investor);
                if outcome(r, &[Error::InvalidAmount]).is_some() {
                    c.deposits += 1;
                }
            }
            6..=7 => {
                let investor = rng.pick(&investors);
                let shares = rng.amount(r.deposit_max / 3);
                outcome(
                    ctx.pool.try_mint(&shares, &investor, &investor, &investor),
                    &[],
                );
                c.deposits += 1;
            }
            8..=15 => {
                let investor = rng.pick(&investors);
                let max = ctx.pool.max_withdraw(&investor);
                if max > 0 {
                    // Half the time drain everything the vault lets out.
                    let assets = if rng.chance(50) { max } else { rng.amount(max) };
                    outcome(
                        ctx.pool
                            .try_withdraw(&assets, &investor, &investor, &investor),
                        &[],
                    );
                    c.withdrawals += 1;
                }
            }
            16..=20 => {
                let investor = rng.pick(&investors);
                let max = ctx.pool.max_redeem(&investor);
                if max > 0 {
                    let shares = if rng.chance(50) { max } else { rng.amount(max) };
                    let r = ctx
                        .pool
                        .try_redeem(&shares, &investor, &investor, &investor);
                    if outcome(r, &[Error::InvalidAmount]).is_some() {
                        c.withdrawals += 1;
                    }
                }
            }
            21..=23 => {
                let from = rng.pick(&investors);
                let to = rng.pick(&investors);
                let balance = ctx.pool.balance(&from);
                if balance > 0 {
                    ctx.pool.transfer(&from, &to, &rng.amount(balance));
                }
            }
            // ---- junior tranche and fees
            24..=26 => {
                outcome(ctx.pool.try_junior_deposit(&rng.amount(r.junior / 4)), &[]);
            }
            27..=29 => {
                let s = ctx.stats();
                // Half the time pull junior down to exactly what the leverage
                // cap needs (within the lendable cash), making the cap bind.
                let floor = (s.total_debt + i128::from(s.params.max_leverage) - 1)
                    / i128::from(s.params.max_leverage);
                let tight = (s.junior_assets - floor).min(s.lendable);
                let amount = if tight > 0 && rng.chance(50) {
                    tight
                } else {
                    rng.amount(s.junior_assets)
                };
                if s.junior_assets > 0 {
                    outcome(
                        ctx.pool.try_junior_withdraw(&amount),
                        &[Error::InsufficientLiquidity, Error::LeverageCapExceeded],
                    );
                }
            }
            30..=32 => {
                let fees = ctx.stats().fees_accrued;
                if fees > 0 {
                    let r = ctx.pool.try_claim_fees(&rng.amount(fees));
                    if outcome(r, &[Error::InsufficientLiquidity]).is_some() {
                        c.fee_claims += 1;
                    }
                }
            }
            // ---- notes and card draws
            33..=46 => {
                let agent = rng.pick(&agents);
                let total = (rng.amount(40_000 * EUR) / CENT).max(1) * CENT;
                let days = 1 + rng.below(365) as u32;
                notes.push(ctx.note(&agent, total, days));
                c.notes += 1;
            }
            47..=68 => {
                let agent = rng.pick(&agents);
                let p = ctx.position(&agent);
                let spendable = p.card_balance + p.borrowable_now;
                let amount = if spendable > 0 && rng.chance(25) {
                    // Spend everything spendable: fills lines to their limit.
                    spendable
                } else {
                    rng.amount(6_000 * EUR)
                };
                if !refs.is_empty() && rng.chance(5) {
                    let reused = rng.pick(&refs);
                    let r = ctx.pool.try_card_draw(&agent, &amount, &reused);
                    assert_eq!(r, Err(Ok(Error::DuplicateDraw)));
                    c.duplicate_draws += 1;
                } else {
                    let auth_ref = ctx.auth_ref();
                    let reasons = [
                        Error::InsufficientCredit,
                        Error::InsufficientLiquidity,
                        Error::LeverageCapExceeded,
                        Error::CardNotEnabled,
                        Error::AgentBlocked,
                    ];
                    match ctx.pool.try_card_draw(&agent, &amount, &auth_ref) {
                        Err(Ok(error)) if reasons.contains(&error) => {
                            let i = reasons.iter().position(|r| *r == error).unwrap();
                            c.rejections[i] += 1;
                            c.rejected_draws += 1;
                        }
                        r => {
                            let result = outcome(r, &[]).unwrap();
                            assert_eq!(result.from_balance + result.from_credit, amount);
                            refs.push(auth_ref);
                            c.draws += 1;
                        }
                    }
                }
            }
            // ---- deal outcomes
            69..=73 => {
                let active = active_notes(&ctx, &notes);
                if !active.is_empty() {
                    let id = rng.pick(&active);
                    let half = ctx.notes.get(&id).agent_commission;
                    let shortfall = ctx.pool.line(&id).debt > half;
                    outcome(ctx.pool.try_settle(&id), &[]);
                    assert_eq!(ctx.notes.get(&id).status, NoteStatus::Settled);
                    c.settles += 1;
                    c.shortfall_settles += u32::from(shortfall);
                }
            }
            74..=76 => {
                let active = active_notes(&ctx, &notes);
                if !active.is_empty() {
                    let id = rng.pick(&active);
                    outcome(ctx.pool.try_cancel(&id), &[]);
                    assert_eq!(ctx.notes.get(&id).status, NoteStatus::Cancelled);
                    c.cancels += 1;
                }
            }
            77..=80 => {
                // Prefer agents whose grace period is over (those must succeed).
                let now = ctx.pool.protocol_now();
                let due: std::vec::Vec<Address> = agents
                    .iter()
                    .filter(|a| ctx.position(a).grace_deadline.is_some_and(|d| d <= now))
                    .cloned()
                    .collect();
                let agent = if due.is_empty() {
                    rng.pick(&agents)
                } else {
                    rng.pick(&due)
                };
                let allowed: &[Error] = if due.is_empty() {
                    &[Error::NothingToWriteOff, Error::GraceNotOver]
                } else {
                    &[]
                };
                if outcome(ctx.pool.try_write_off(&agent), allowed).is_some() {
                    let p = ctx.position(&agent);
                    assert!(p.blocked && p.carried_debt == 0 && p.grace_deadline.is_none());
                    c.write_offs += 1;
                }
            }
            // ---- time
            81..=88 => {
                let now = ctx.pool.protocol_now();
                let deadlines: std::vec::Vec<u64> = agents
                    .iter()
                    .filter_map(|a| ctx.position(a).grace_deadline)
                    .filter(|d| *d > now && *d - now <= 400 * DAY)
                    .collect();
                if !deadlines.is_empty() && rng.chance(30) {
                    // Jump straight to a grace deadline.
                    ctx.pool.advance_clock(&(rng.pick(&deadlines) - now));
                } else if rng.chance(20) {
                    // Real time passes (ledger clock), no pool call.
                    let secs = 60 + rng.below(3 * DAY);
                    ctx.e
                        .ledger()
                        .set_timestamp(ctx.e.ledger().timestamp() + secs);
                } else {
                    let secs = match rng.below(20) {
                        0 => 30 * DAY + rng.below(170 * DAY),
                        1..=5 => 3 * DAY + rng.below(27 * DAY),
                        _ => 3_600 + rng.below(3 * DAY),
                    };
                    ctx.pool.advance_clock(&secs);
                }
                c.clock_moves += 1;
            }
            // ---- agent admin
            89..=91 => {
                let agent = rng.pick(&agents);
                ctx.pool.set_blocked(&agent, &rng.chance(20));
            }
            92..=94 => {
                let agent = rng.pick(&agents);
                let balance = ctx.position(&agent).card_balance;
                if balance > 0 {
                    let to = Address::generate(&ctx.e);
                    let amount = rng.amount(balance);
                    ctx.pool.withdraw_balance(&agent, &amount, &to);
                    assert_eq!(ctx.token.balance(&to), amount);
                }
            }
            95..=97 => {
                let agent = rng.pick(&agents);
                if rng.chance(90) {
                    ctx.pool.enable_card(&agent);
                } else {
                    ctx.pool.disable_card(&agent);
                }
            }
            _ => ctx.pool.accrue(),
        }
        check(&ctx, &investors, &agents);
    }
    c
}

fn active_notes(ctx: &Ctx, notes: &[u32]) -> std::vec::Vec<u32> {
    notes
        .iter()
        .copied()
        .filter(|id| ctx.pool.line(id).line.status == LineStatus::Active)
        .collect()
}

/// Everything that must hold after any operation.
fn check(ctx: &Ctx, investors: &[Address], agents: &[Address]) {
    let s = ctx.stats();
    // Spec §5.3, with no rounding dust at all (see Pool::book_rounding).
    assert_eq!(
        s.senior_assets + s.junior_assets + s.fees_accrued,
        s.pool_cash + s.total_debt,
        "core invariant broken: {s:?}"
    );
    assert_eq!(
        s.pool_cash,
        ctx.token.balance(&ctx.pool.address) - s.total_card_balances
    );
    assert!(s.senior_assets >= 0 && s.junior_assets >= 0, "{s:?}");
    assert!(s.fees_accrued >= 0 && s.pool_cash >= 0, "{s:?}");
    assert_eq!(s.lendable, (s.pool_cash - s.fees_accrued).max(0));
    assert_eq!(
        s.leverage_headroom,
        (i128::from(s.params.max_leverage) * s.junior_assets - s.total_debt).max(0)
    );

    // Per-agent bookkeeping adds up to the pool totals.
    let mut card_balances = 0;
    let mut principal = 0;
    let mut debts = 0;
    let mut positions = 0i128;
    for agent in agents {
        let p = ctx.position(agent);
        assert!(p.card_balance >= 0 && p.carried_debt >= 0, "{p:?}");
        assert!(p.borrowable_now <= p.available_credit, "{p:?}");
        assert!(p.borrowable_now <= s.lendable && p.borrowable_now <= s.leverage_headroom);
        if p.blocked {
            assert_eq!(p.available_credit, 0);
        }
        // Carried debt always has a grace deadline, and only carried debt.
        assert_eq!(p.carried_debt > 0, p.grace_deadline.is_some(), "{p:?}");
        let line_room: i128 = p.lines.iter().map(|v| v.available).sum();
        if !p.blocked {
            assert_eq!(p.available_credit, (line_room - p.carried_debt).max(0));
        }
        for view in p.lines.iter() {
            assert_eq!(view.line.status, LineStatus::Active);
            assert_eq!(view.interest, (view.debt - view.line.principal).max(0));
        }
        card_balances += p.card_balance;
        principal += p.total_principal;
        debts += p.total_debt;
        positions += i128::from(p.lines.len()) + 1;
    }
    assert_eq!(card_balances, s.total_card_balances);
    assert_eq!(principal, s.total_principal);
    // Position debts round up, the pool's total rounds down.
    assert!(
        debts >= s.total_debt && debts <= s.total_debt + positions + 1,
        "{debts} vs {s:?}"
    );

    // eaSR supply is fully held by the investors.
    let shares: i128 = investors.iter().map(|i| ctx.pool.balance(i)).sum();
    assert_eq!(shares, s.share_supply);
    assert_eq!(s.senior_assets, ctx.pool.total_assets());
}
