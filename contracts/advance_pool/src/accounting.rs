//! Borrow-index accounting (§5.2), credit availability (§5.4) and the
//! senior-vault conversions (§5.5). Rounding always favours the pool.

use crate::storage::{read_line, Book};
use crate::types::{AgentState, LineStatus, Params};
use advance_shared::math::{add, mul, mul_div_ceil, mul_div_floor, sub, BPS, SCALE, YEAR};
use soroban_sdk::Env;

pub fn protocol_now(e: &Env, book: &Book) -> u64 {
    e.ledger().timestamp() + book.demo_offset
}

/// §5.2 `accrue()`, applied to an in-memory book (callers decide whether to save).
pub fn accrue(e: &Env, book: &mut Book, p: &Params) {
    let now = protocol_now(e, book);
    if now <= book.last_accrual {
        return;
    }
    let dt = (now - book.last_accrual) as i128;
    let old_debt = total_debt(e, book);
    let growth = mul_div_floor(e, book.borrow_index, mul(e, p.agent_apr_bps as i128, dt), mul(e, BPS, YEAR));
    book.borrow_index = add(e, book.borrow_index, growth);
    let new_debt = total_debt(e, book);
    let interest = sub(e, new_debt, old_debt);
    let fee = mul_div_floor(e, interest, p.protocol_fee_bps as i128, BPS);
    let net = sub(e, interest, fee);
    let senior_due = mul_div_floor(e, book.senior_assets, mul(e, p.senior_target_bps as i128, dt), mul(e, BPS, YEAR));
    let to_senior = net.min(senior_due).max(0);
    let to_junior = sub(e, net, to_senior);
    book.fees_accrued = add(e, book.fees_accrued, fee);
    book.senior_assets = add(e, book.senior_assets, to_senior);
    book.junior_assets = add(e, book.junior_assets, to_junior);
    book.last_accrual = now;
}

/// Pool-wide debt: floor(total_scaled × index / SCALE).
pub fn total_debt(e: &Env, book: &Book) -> i128 {
    mul_div_floor(e, book.total_scaled_debt, book.borrow_index, SCALE)
}

/// Debt of one scaled position, rounded up.
pub fn debt_of(e: &Env, scaled: i128, index: i128) -> i128 {
    if scaled == 0 {
        0
    } else {
        mul_div_ceil(e, scaled, index, SCALE)
    }
}

/// Scaled debt added when borrowing `amount` (rounded up).
pub fn scaled_for_borrow(e: &Env, amount: i128, index: i128) -> i128 {
    mul_div_ceil(e, amount, SCALE, index)
}

/// Scaled debt removed when partially repaying `amount` (rounded down).
pub fn scaled_for_repay(e: &Env, amount: i128, index: i128) -> i128 {
    mul_div_floor(e, amount, SCALE, index)
}

pub fn lendable(pool_cash: i128, book: &Book) -> i128 {
    (pool_cash - book.fees_accrued).max(0)
}

pub fn leverage_headroom(e: &Env, book: &Book, p: &Params) -> i128 {
    let cap = mul(e, p.max_leverage as i128, book.junior_assets.max(0));
    (cap - total_debt(e, book)).max(0)
}

/// Σ line_available over active lines (before carried debt and blocking).
pub fn lines_available(e: &Env, state: &AgentState, index: i128) -> i128 {
    let mut sum = 0i128;
    for id in state.active_lines.iter() {
        if let Some(line) = read_line(e, id) {
            if line.status == LineStatus::Active {
                let avail = (line.credit_limit - debt_of(e, line.scaled_debt, index)).max(0);
                sum = add(e, sum, avail);
            }
        }
    }
    sum
}

pub fn carried_debt(e: &Env, state: &AgentState, index: i128) -> i128 {
    debt_of(e, state.carried_scaled, index)
}

/// §5.4 agent_available_credit.
pub fn agent_available_credit(e: &Env, state: &AgentState, index: i128) -> i128 {
    if state.blocked {
        return 0;
    }
    (lines_available(e, state, index) - carried_debt(e, state, index)).max(0)
}

// ---- SEP-56 conversions (§5.5), virtual +1 on both sides ----

pub fn to_shares_floor(e: &Env, assets: i128, supply: i128, total_assets: i128) -> i128 {
    mul_div_floor(e, assets, add(e, supply, 1), add(e, total_assets, 1))
}

pub fn to_shares_ceil(e: &Env, assets: i128, supply: i128, total_assets: i128) -> i128 {
    mul_div_ceil(e, assets, add(e, supply, 1), add(e, total_assets, 1))
}

pub fn to_assets_floor(e: &Env, shares: i128, supply: i128, total_assets: i128) -> i128 {
    mul_div_floor(e, shares, add(e, total_assets, 1), add(e, supply, 1))
}

pub fn to_assets_ceil(e: &Env, shares: i128, supply: i128, total_assets: i128) -> i128 {
    mul_div_ceil(e, shares, add(e, total_assets, 1), add(e, supply, 1))
}
