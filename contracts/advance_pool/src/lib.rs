#![no_std]
//! `advance_pool` — the explorador advance liquidity pool (spec §5, §7.3):
//! a SEP-56 senior vault (share token `eaSR`, SEP-41), the junior first-loss
//! tranche, per-note credit lines drawn by card, settlement at the escritura,
//! cancellation → grace → write-off, and a demo-mode protocol clock.

mod accounting;
pub mod events;
mod storage;
pub mod types;

use accounting as acc;
use advance_shared::{
    interfaces::NoteClient,
    math::{add, mul_div_floor, sub, BPS, DAY_SECS, SCALE},
    ttl, Error, NoteStatus,
};
use events::*;
use soroban_sdk::{
    contract, contractimpl, panic_with_error, token::TokenClient, Address, BytesN, Env, MuxedAddress, String, Vec,
};
use storage::{read_agent, read_line, write_agent, write_line, Book, DataKey};
use stellar_tokens::{
    fungible::{burnable::FungibleBurnable, Base, FungibleToken},
    vault::{emit_deposit, emit_withdraw},
};
pub use types::*;

/// Largest single `advance_clock` step.
pub const MAX_CLOCK_STEP_SECS: u64 = 400 * DAY_SECS;

#[contract]
pub struct AdvancePool;

// ------------------------------------------------------------------ internals

fn load(e: &Env) -> (Params, Book) {
    ttl::bump_instance(e);
    (storage::params(e), Book::load(e))
}

/// Loads the book and applies `accrue()` (caller saves).
fn load_accrued(e: &Env) -> (Params, Book) {
    let (p, mut book) = load(e);
    acc::accrue(e, &mut book, &p);
    (p, book)
}

fn asset(e: &Env) -> TokenClient<'_> {
    TokenClient::new(e, &storage::get_addr(e, &DataKey::Asset))
}

fn pool_cash(e: &Env, book: &Book) -> i128 {
    asset(e).balance(&e.current_contract_address()) - book.total_card_balances
}

fn require_role(e: &Env, key: DataKey) -> Address {
    let a = storage::get_addr(e, &key);
    a.require_auth();
    a
}

fn positive(amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        Err(Error::InvalidAmount)
    } else {
        Ok(())
    }
}

fn line_view(e: &Env, line: Line, index: i128) -> LineView {
    let debt = acc::debt_of(e, line.scaled_debt, index);
    let interest = (debt - line.principal).max(0);
    let available = if line.status == LineStatus::Active {
        (line.credit_limit - debt).max(0)
    } else {
        0
    };
    LineView { line, debt, interest, available }
}

fn without(e: &Env, ids: &Vec<u32>, id: u32) -> Vec<u32> {
    let mut out = Vec::new(e);
    for x in ids.iter() {
        if x != id {
            out.push_back(x);
        }
    }
    out
}

/// Repays up to `amount` of the agent's carried debt. Returns the amount repaid.
/// Interest is repaid before principal (principal is informational).
fn repay_carried(e: &Env, book: &mut Book, state: &mut AgentState, amount: i128) -> i128 {
    let carried = acc::carried_debt(e, state, book.borrow_index);
    let repay = amount.min(carried).max(0);
    if repay == 0 {
        return 0;
    }
    if repay == carried {
        book.total_scaled_debt = sub(e, book.total_scaled_debt, state.carried_scaled);
        book.total_principal = sub(e, book.total_principal, state.carried_principal);
        state.carried_scaled = 0;
        state.carried_principal = 0;
    } else {
        let scaled = acc::scaled_for_repay(e, repay, book.borrow_index).min(state.carried_scaled);
        let interest = (carried - state.carried_principal).max(0);
        let principal_part = (repay - interest).max(0).min(state.carried_principal);
        state.carried_scaled = sub(e, state.carried_scaled, scaled);
        book.total_scaled_debt = sub(e, book.total_scaled_debt, scaled);
        state.carried_principal = sub(e, state.carried_principal, principal_part);
        book.total_principal = sub(e, book.total_principal, principal_part);
    }
    if state.carried_scaled == 0 {
        state.grace_deadline = None;
    }
    repay
}

fn position(e: &Env, agent: &Address, p: &Params, book: &Book) -> AgentPosition {
    let state = read_agent(e, agent);
    let index = book.borrow_index;
    let mut lines = Vec::new(e);
    let mut total_debt = 0i128;
    let mut total_principal = 0i128;
    for id in state.active_lines.iter() {
        if let Some(line) = read_line(e, id) {
            let v = line_view(e, line, index);
            total_debt = add(e, total_debt, v.debt);
            total_principal = add(e, total_principal, v.line.principal);
            lines.push_back(v);
        }
    }
    let carried = acc::carried_debt(e, &state, index);
    let available_credit = acc::agent_available_credit(e, &state, index);
    let cash = pool_cash(e, book);
    let borrowable_now = available_credit
        .min(acc::lendable(cash, book))
        .min(acc::leverage_headroom(e, book, p));
    AgentPosition {
        card_balance: state.card_balance,
        card_enabled: state.card_enabled,
        blocked: state.blocked,
        lines,
        carried_debt: carried,
        grace_deadline: state.grace_deadline,
        total_debt: add(e, total_debt, carried),
        total_principal: add(e, total_principal, state.carried_principal),
        available_credit,
        borrowable_now,
    }
}

fn total_assets_of(book: &Book) -> i128 {
    book.senior_assets.max(0)
}

fn shares_balance(e: &Env, owner: &Address) -> i128 {
    Base::balance(e, owner)
}

fn max_withdraw_of(e: &Env, owner: &Address, book: &Book) -> i128 {
    let assets = acc::to_assets_floor(e, shares_balance(e, owner), book.share_supply, total_assets_of(book));
    assets.min(acc::lendable(pool_cash(e, book), book))
}

fn max_redeem_of(e: &Env, owner: &Address, book: &Book) -> i128 {
    let liquid = acc::to_shares_floor(e, acc::lendable(pool_cash(e, book), book), book.share_supply, total_assets_of(book));
    shares_balance(e, owner).min(liquid)
}

fn do_deposit(e: &Env, book: &mut Book, assets: i128, shares: i128, receiver: &Address, from: &Address, operator: &Address) {
    let me = e.current_contract_address();
    if operator == from {
        asset(e).transfer(from, &me, &assets);
    } else {
        asset(e).transfer_from(operator, from, &me, &assets);
    }
    book.senior_assets = add(e, book.senior_assets, assets);
    book.share_supply = add(e, book.share_supply, shares);
    Base::update(e, None, Some(receiver), shares);
    book.save(e);
    emit_deposit(e, operator, from, receiver, assets, shares);
}

fn do_withdraw(e: &Env, book: &mut Book, assets: i128, shares: i128, receiver: &Address, owner: &Address, operator: &Address) {
    if operator != owner {
        Base::spend_allowance(e, owner, operator, shares);
    }
    Base::update(e, Some(owner), None, shares);
    book.share_supply = sub(e, book.share_supply, shares);
    book.senior_assets = sub(e, book.senior_assets, assets);
    book.save(e);
    asset(e).transfer(&e.current_contract_address(), receiver, &assets);
    emit_withdraw(e, operator, receiver, owner, assets, shares);
}

// ------------------------------------------------------------------ contract

#[contractimpl]
impl AdvancePool {
    pub fn __constructor(
        e: Env,
        admin: Address,
        operator: Address,
        treasury: Address,
        card_settlement: Address,
        asset: Address,
        note_contract: Address,
        params: Params,
    ) {
        if params.ltv_bps as i128 > BPS
            || params.protocol_fee_bps as i128 > BPS
            || params.senior_target_bps as i128 > BPS
            || params.max_leverage == 0
        {
            panic_with_error!(&e, Error::InvalidParams);
        }
        let s = e.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Operator, &operator);
        s.set(&DataKey::Treasury, &treasury);
        s.set(&DataKey::CardSettlement, &card_settlement);
        s.set(&DataKey::Asset, &asset);
        s.set(&DataKey::NoteContract, &note_contract);
        s.set(&DataKey::Params, &params);
        let book = Book {
            demo_offset: 0,
            last_accrual: e.ledger().timestamp(),
            borrow_index: SCALE,
            total_scaled_debt: 0,
            total_principal: 0,
            senior_assets: 0,
            junior_assets: 0,
            fees_accrued: 0,
            total_card_balances: 0,
            written_off_total: 0,
            share_supply: 0,
        };
        book.save(&e);
        Base::set_metadata(
            &e,
            7,
            String::from_str(&e, "explorador advance Senior"),
            String::from_str(&e, "eaSR"),
        );
    }

    // ============================================================ SEP-56 vault

    pub fn total_supply(e: Env) -> i128 {
        Book::load(&e).share_supply
    }

    pub fn query_asset(e: Env) -> Address {
        storage::get_addr(&e, &DataKey::Asset)
    }

    /// Accounting-based (not balance-based): donations cannot move the share price.
    pub fn total_assets(e: Env) -> i128 {
        let (_, book) = load_accrued(&e);
        total_assets_of(&book)
    }

    pub fn convert_to_shares(e: Env, assets: i128) -> i128 {
        let (_, book) = load_accrued(&e);
        acc::to_shares_floor(&e, assets, book.share_supply, total_assets_of(&book))
    }

    pub fn convert_to_assets(e: Env, shares: i128) -> i128 {
        let (_, book) = load_accrued(&e);
        acc::to_assets_floor(&e, shares, book.share_supply, total_assets_of(&book))
    }

    pub fn max_deposit(_e: Env, _receiver: Address) -> i128 {
        i128::MAX
    }

    pub fn preview_deposit(e: Env, assets: i128) -> i128 {
        Self::convert_to_shares(e, assets)
    }

    pub fn deposit(e: Env, assets: i128, receiver: Address, from: Address, operator: Address) -> Result<i128, Error> {
        operator.require_auth();
        positive(assets)?;
        let (_, mut book) = load_accrued(&e);
        let shares = acc::to_shares_floor(&e, assets, book.share_supply, total_assets_of(&book));
        positive(shares)?;
        do_deposit(&e, &mut book, assets, shares, &receiver, &from, &operator);
        Ok(shares)
    }

    pub fn max_mint(_e: Env, _receiver: Address) -> i128 {
        i128::MAX
    }

    pub fn preview_mint(e: Env, shares: i128) -> i128 {
        let (_, book) = load_accrued(&e);
        acc::to_assets_ceil(&e, shares, book.share_supply, total_assets_of(&book))
    }

    pub fn mint(e: Env, shares: i128, receiver: Address, from: Address, operator: Address) -> Result<i128, Error> {
        operator.require_auth();
        positive(shares)?;
        let (_, mut book) = load_accrued(&e);
        let assets = acc::to_assets_ceil(&e, shares, book.share_supply, total_assets_of(&book));
        positive(assets)?;
        do_deposit(&e, &mut book, assets, shares, &receiver, &from, &operator);
        Ok(assets)
    }

    pub fn max_withdraw(e: Env, owner: Address) -> i128 {
        let (_, book) = load_accrued(&e);
        max_withdraw_of(&e, &owner, &book)
    }

    pub fn preview_withdraw(e: Env, assets: i128) -> i128 {
        let (_, book) = load_accrued(&e);
        acc::to_shares_ceil(&e, assets, book.share_supply, total_assets_of(&book))
    }

    pub fn withdraw(e: Env, assets: i128, receiver: Address, owner: Address, operator: Address) -> Result<i128, Error> {
        operator.require_auth();
        positive(assets)?;
        let (_, mut book) = load_accrued(&e);
        if assets > max_withdraw_of(&e, &owner, &book) {
            return Err(Error::ExceedsMaximum);
        }
        let shares = acc::to_shares_ceil(&e, assets, book.share_supply, total_assets_of(&book));
        do_withdraw(&e, &mut book, assets, shares, &receiver, &owner, &operator);
        Ok(shares)
    }

    pub fn max_redeem(e: Env, owner: Address) -> i128 {
        let (_, book) = load_accrued(&e);
        max_redeem_of(&e, &owner, &book)
    }

    pub fn preview_redeem(e: Env, shares: i128) -> i128 {
        Self::convert_to_assets(e, shares)
    }

    pub fn redeem(e: Env, shares: i128, receiver: Address, owner: Address, operator: Address) -> Result<i128, Error> {
        operator.require_auth();
        positive(shares)?;
        let (_, mut book) = load_accrued(&e);
        if shares > max_redeem_of(&e, &owner, &book) {
            return Err(Error::ExceedsMaximum);
        }
        let assets = acc::to_assets_floor(&e, shares, book.share_supply, total_assets_of(&book));
        positive(assets)?;
        do_withdraw(&e, &mut book, assets, shares, &receiver, &owner, &operator);
        Ok(assets)
    }

    // ============================================================ clock & accounting

    pub fn protocol_now(e: Env) -> u64 {
        acc::protocol_now(&e, &Book::load(&e))
    }

    /// Admin, demo mode only: accrue, then move the protocol clock forward.
    pub fn advance_clock(e: Env, secs: u64) -> Result<u64, Error> {
        require_role(&e, DataKey::Admin);
        let (p, mut book) = load_accrued(&e);
        if !p.demo_mode {
            return Err(Error::DemoModeDisabled);
        }
        if secs == 0 {
            return Err(Error::InvalidAmount);
        }
        if secs > MAX_CLOCK_STEP_SECS {
            return Err(Error::ClockAdvanceTooLarge);
        }
        book.demo_offset = book.demo_offset.checked_add(secs).ok_or(Error::MathOverflow)?;
        book.save(&e);
        let now = acc::protocol_now(&e, &book);
        ClockAdvanced { secs, protocol_now: now }.publish(&e);
        Ok(now)
    }

    /// Anyone.
    pub fn accrue(e: Env) {
        let (_, book) = load_accrued(&e);
        book.save(&e);
    }

    pub fn stats(e: Env) -> PoolStats {
        let (p, book) = load_accrued(&e);
        let total_debt = acc::total_debt(&e, &book);
        let cash = pool_cash(&e, &book);
        let ta = total_assets_of(&book);
        let tranches = book.senior_assets + book.junior_assets;
        let utilization_bps = if tranches > 0 {
            mul_div_floor(&e, total_debt, BPS, tranches).clamp(0, u32::MAX as i128) as u32
        } else {
            0
        };
        let leverage_x100 = if total_debt == 0 {
            0
        } else if book.junior_assets <= 0 {
            u32::MAX
        } else {
            mul_div_floor(&e, total_debt, 100, book.junior_assets).clamp(0, u32::MAX as i128) as u32
        };
        PoolStats {
            senior_assets: book.senior_assets,
            junior_assets: book.junior_assets,
            fees_accrued: book.fees_accrued,
            total_debt,
            total_principal: book.total_principal,
            pool_cash: cash,
            total_card_balances: book.total_card_balances,
            share_supply: book.share_supply,
            share_price_scaled: mul_div_floor(&e, ta + 1, SCALE, book.share_supply + 1),
            utilization_bps,
            leverage_x100,
            lendable: acc::lendable(cash, &book),
            leverage_headroom: acc::leverage_headroom(&e, &book, &p),
            borrow_index: book.borrow_index,
            protocol_now: acc::protocol_now(&e, &book),
            params: p,
            written_off_total: book.written_off_total,
        }
    }

    pub fn params(e: Env) -> Params {
        storage::params(&e)
    }

    // ============================================================ credit lines

    /// Note contract only. Soroban forbids re-entrancy, so the note passes its terms.
    pub fn open_line(e: Env, note_id: u32, agent: Address, agent_commission: i128, escritura_day: u32) -> Result<(), Error> {
        require_role(&e, DataKey::NoteContract);
        positive(agent_commission)?;
        if read_line(&e, note_id).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        let (p, book) = load_accrued(&e);
        let credit_limit = mul_div_floor(&e, agent_commission, p.ltv_bps as i128, BPS);
        let line = Line {
            note_id,
            agent: agent.clone(),
            credit_limit,
            principal: 0,
            scaled_debt: 0,
            escritura_day,
            status: LineStatus::Active,
        };
        write_line(&e, &line);
        let mut state = read_agent(&e, &agent);
        state.active_lines.push_back(note_id);
        write_agent(&e, &agent, &state);
        book.save(&e);
        LineOpened { note_id, agent, credit_limit }.publish(&e);
        Ok(())
    }

    pub fn line(e: Env, note_id: u32) -> Result<LineView, Error> {
        let (_, book) = load_accrued(&e);
        let line = read_line(&e, note_id).ok_or(Error::UnknownNote)?;
        Ok(line_view(&e, line, book.borrow_index))
    }

    pub fn agent_position(e: Env, agent: Address) -> AgentPosition {
        let (p, book) = load_accrued(&e);
        position(&e, &agent, &p, &book)
    }

    pub fn agent_state(e: Env, agent: Address) -> AgentState {
        read_agent(&e, &agent)
    }

    // ============================================================ card

    /// The agent's on-chain consent (passkey) for the operator to draw by card.
    pub fn enable_card(e: Env, agent: Address) {
        agent.require_auth();
        let mut state = read_agent(&e, &agent);
        state.card_enabled = true;
        write_agent(&e, &agent, &state);
        ttl::bump_instance(&e);
        CardEnabled { agent, enabled: true }.publish(&e);
    }

    pub fn disable_card(e: Env, agent: Address) {
        agent.require_auth();
        let mut state = read_agent(&e, &agent);
        state.card_enabled = false;
        write_agent(&e, &agent, &state);
        ttl::bump_instance(&e);
        CardEnabled { agent, enabled: false }.publish(&e);
    }

    /// Operator: funds a card spend from the card balance first, then credit
    /// (earliest escritura first), paying `card_settlement`.
    pub fn card_draw(e: Env, agent: Address, amount: i128, auth_ref: BytesN<32>) -> Result<DrawResult, Error> {
        require_role(&e, DataKey::Operator);
        positive(amount)?;
        if storage::draw_used(&e, &auth_ref) {
            return Err(Error::DuplicateDraw);
        }
        let (p, mut book) = load_accrued(&e);
        let mut state = read_agent(&e, &agent);
        if !state.card_enabled {
            return Err(Error::CardNotEnabled);
        }
        let from_balance = state.card_balance.min(amount);
        let from_credit = amount - from_balance;
        if from_credit > 0 {
            if state.blocked {
                return Err(Error::AgentBlocked);
            }
            let index = book.borrow_index;
            if from_credit > acc::agent_available_credit(&e, &state, index) {
                return Err(Error::InsufficientCredit);
            }
            if from_credit > acc::lendable(pool_cash(&e, &book), &book) {
                return Err(Error::InsufficientLiquidity);
            }
            if from_credit > acc::leverage_headroom(&e, &book, &p) {
                return Err(Error::LeverageCapExceeded);
            }
            // Allocate across active lines, earliest escritura first (ties: lower id).
            let mut pending: Vec<Line> = Vec::new(&e);
            for id in state.active_lines.iter() {
                if let Some(l) = read_line(&e, id) {
                    if l.status == LineStatus::Active {
                        pending.push_back(l);
                    }
                }
            }
            let mut remaining = from_credit;
            while remaining > 0 && !pending.is_empty() {
                let mut best = 0u32;
                for i in 1..pending.len() {
                    let (a, b) = (pending.get_unchecked(i), pending.get_unchecked(best));
                    if (a.escritura_day, a.note_id) < (b.escritura_day, b.note_id) {
                        best = i;
                    }
                }
                let mut line = pending.get_unchecked(best);
                pending.remove(best);
                let avail = (line.credit_limit - acc::debt_of(&e, line.scaled_debt, index)).max(0);
                let take = avail.min(remaining);
                if take == 0 {
                    continue;
                }
                let scaled = acc::scaled_for_borrow(&e, take, index);
                line.scaled_debt = add(&e, line.scaled_debt, scaled);
                line.principal = add(&e, line.principal, take);
                book.total_scaled_debt = add(&e, book.total_scaled_debt, scaled);
                book.total_principal = add(&e, book.total_principal, take);
                write_line(&e, &line);
                remaining -= take;
            }
            if remaining > 0 {
                return Err(Error::InsufficientCredit);
            }
        }
        state.card_balance = sub(&e, state.card_balance, from_balance);
        book.total_card_balances = sub(&e, book.total_card_balances, from_balance);
        write_agent(&e, &agent, &state);
        storage::mark_draw(&e, &auth_ref);
        book.save(&e);
        asset(&e).transfer(
            &e.current_contract_address(),
            &storage::get_addr(&e, &DataKey::CardSettlement),
            &amount,
        );
        CardDraw { agent, amount, from_balance, from_credit, auth_ref }.publish(&e);
        Ok(DrawResult { from_balance, from_credit })
    }

    /// Agent (passkey): moves card balance out of the pool.
    pub fn withdraw_balance(e: Env, agent: Address, amount: i128, to: Address) -> Result<(), Error> {
        agent.require_auth();
        positive(amount)?;
        let (_, mut book) = load_accrued(&e);
        let mut state = read_agent(&e, &agent);
        if amount > state.card_balance {
            return Err(Error::InsufficientBalance);
        }
        state.card_balance -= amount;
        book.total_card_balances = sub(&e, book.total_card_balances, amount);
        write_agent(&e, &agent, &state);
        book.save(&e);
        asset(&e).transfer(&e.current_contract_address(), &to, &amount);
        BalanceWithdrawn { agent, amount, to }.publish(&e);
        Ok(())
    }

    // ============================================================ deal outcomes

    /// Operator + treasury: the escritura happened; the commission pays the debt.
    pub fn settle(e: Env, note_id: u32) -> Result<(), Error> {
        let operator = require_role(&e, DataKey::Operator);
        let treasury = storage::get_addr(&e, &DataKey::Treasury);
        // One auth per address per frame: a shared operator/treasury key signs once.
        if treasury != operator {
            treasury.require_auth();
        }
        let (_, mut book) = load_accrued(&e);
        let mut line = read_line(&e, note_id).ok_or(Error::UnknownNote)?;
        if line.status != LineStatus::Active {
            return Err(Error::LineNotActive);
        }
        let note_contract = storage::get_addr(&e, &DataKey::NoteContract);
        let notes = NoteClient::new(&e, &note_contract);
        let note = notes.get(&note_id);
        if note.status != NoteStatus::Active || note.agent != line.agent {
            return Err(Error::LineNotActive);
        }
        asset(&e).transfer(&treasury, &e.current_contract_address(), &note.total_commission);

        let index = book.borrow_index;
        let agent = line.agent.clone();
        let mut state = read_agent(&e, &agent);
        let d = acc::debt_of(&e, line.scaled_debt, index);
        let line_interest = (d - line.principal).max(0);
        let mut remaining = note.agent_commission;
        let debt_repaid;
        if remaining >= d {
            debt_repaid = d;
            book.total_scaled_debt = sub(&e, book.total_scaled_debt, line.scaled_debt);
            book.total_principal = sub(&e, book.total_principal, line.principal);
            remaining -= d;
        } else {
            // Shortfall: the agent's whole half repays part, the rest becomes carried debt.
            debt_repaid = remaining;
            let repaid_scaled = acc::scaled_for_repay(&e, remaining, index).min(line.scaled_debt);
            let principal_repaid = (remaining - line_interest).max(0).min(line.principal);
            book.total_scaled_debt = sub(&e, book.total_scaled_debt, repaid_scaled);
            book.total_principal = sub(&e, book.total_principal, principal_repaid);
            state.carried_scaled = add(&e, state.carried_scaled, line.scaled_debt - repaid_scaled);
            state.carried_principal = add(&e, state.carried_principal, line.principal - principal_repaid);
            remaining = 0;
        }
        let interest_paid = line_interest.min(debt_repaid);
        let carried_repaid = repay_carried(&e, &mut book, &mut state, remaining);
        let payout = remaining - carried_repaid;
        if state.carried_scaled > 0 && state.grace_deadline.is_none() {
            let p = storage::params(&e);
            state.grace_deadline = Some(acc::protocol_now(&e, &book) + p.grace_period_secs);
        }
        state.card_balance = add(&e, state.card_balance, payout);
        book.total_card_balances = add(&e, book.total_card_balances, payout);
        book.junior_assets = add(&e, book.junior_assets, note.explorador_commission);
        state.active_lines = without(&e, &state.active_lines, note_id);
        line.scaled_debt = 0;
        line.status = LineStatus::Settled;
        write_line(&e, &line);
        write_agent(&e, &agent, &state);
        book.save(&e);
        notes.set_status(&note_id, &NoteStatus::Settled);
        NoteSettled {
            note_id,
            agent,
            total_commission: note.total_commission,
            debt_repaid,
            interest_paid,
            carried_repaid,
            agent_payout: payout,
            junior_deposit: note.explorador_commission,
        }
        .publish(&e);
        Ok(())
    }

    /// Operator: the buyer walked away. The line's debt becomes the agent's carried debt.
    pub fn cancel(e: Env, note_id: u32) -> Result<(), Error> {
        require_role(&e, DataKey::Operator);
        let (p, mut book) = load_accrued(&e);
        let mut line = read_line(&e, note_id).ok_or(Error::UnknownNote)?;
        if line.status != LineStatus::Active {
            return Err(Error::LineNotActive);
        }
        let agent = line.agent.clone();
        let mut state = read_agent(&e, &agent);
        let debt_carried = acc::debt_of(&e, line.scaled_debt, book.borrow_index);
        state.carried_scaled = add(&e, state.carried_scaled, line.scaled_debt);
        state.carried_principal = add(&e, state.carried_principal, line.principal);
        state.active_lines = without(&e, &state.active_lines, note_id);
        line.scaled_debt = 0;
        line.status = LineStatus::Cancelled;

        // Any card balance repays carried debt immediately.
        let balance = state.card_balance;
        let repaid = repay_carried(&e, &mut book, &mut state, balance);
        state.card_balance -= repaid;
        book.total_card_balances = sub(&e, book.total_card_balances, repaid);
        if state.carried_scaled > 0 && state.grace_deadline.is_none() {
            state.grace_deadline = Some(acc::protocol_now(&e, &book) + p.grace_period_secs);
        }
        write_line(&e, &line);
        write_agent(&e, &agent, &state);
        book.save(&e);
        NoteClient::new(&e, &storage::get_addr(&e, &DataKey::NoteContract)).set_status(&note_id, &NoteStatus::Cancelled);
        NoteCancelled { note_id, agent, debt_carried, grace_deadline: state.grace_deadline }.publish(&e);
        Ok(())
    }

    /// Operator, after the grace deadline: losses hit junior first, then senior.
    pub fn write_off(e: Env, agent: Address) -> Result<(), Error> {
        require_role(&e, DataKey::Operator);
        let (_, mut book) = load_accrued(&e);
        let mut state = read_agent(&e, &agent);
        if state.carried_scaled == 0 {
            return Err(Error::NothingToWriteOff);
        }
        let deadline = state.grace_deadline.ok_or(Error::GraceNotOver)?;
        if acc::protocol_now(&e, &book) < deadline {
            return Err(Error::GraceNotOver);
        }
        let loss = acc::carried_debt(&e, &state, book.borrow_index);
        book.total_scaled_debt = sub(&e, book.total_scaled_debt, state.carried_scaled);
        book.total_principal = sub(&e, book.total_principal, state.carried_principal);
        let junior_loss = loss.min(book.junior_assets.max(0));
        book.junior_assets -= junior_loss;
        let senior_loss = (loss - junior_loss).min(book.senior_assets.max(0));
        book.senior_assets -= senior_loss;
        // Only reachable if both tranches are exhausted: the fee reserve covers the rest.
        let residual = loss - junior_loss - senior_loss;
        book.fees_accrued -= residual.min(book.fees_accrued.max(0));
        book.written_off_total = add(&e, book.written_off_total, loss);
        state.carried_scaled = 0;
        state.carried_principal = 0;
        state.grace_deadline = None;
        state.blocked = true;
        state.written_off_total = add(&e, state.written_off_total, loss);
        write_agent(&e, &agent, &state);
        book.save(&e);
        DebtWrittenOff { agent, amount: loss, junior_loss, senior_loss }.publish(&e);
        Ok(())
    }

    pub fn set_blocked(e: Env, agent: Address, blocked: bool) {
        require_role(&e, DataKey::Operator);
        let (_, book) = load_accrued(&e);
        let mut state = read_agent(&e, &agent);
        state.blocked = blocked;
        write_agent(&e, &agent, &state);
        book.save(&e);
        BlockedSet { agent, blocked }.publish(&e);
    }

    // ============================================================ junior tranche & fees

    pub fn junior_deposit(e: Env, amount: i128) -> Result<(), Error> {
        let treasury = require_role(&e, DataKey::Treasury);
        positive(amount)?;
        let (_, mut book) = load_accrued(&e);
        asset(&e).transfer(&treasury, &e.current_contract_address(), &amount);
        book.junior_assets = add(&e, book.junior_assets, amount);
        book.save(&e);
        JuniorDeposit { amount }.publish(&e);
        Ok(())
    }

    pub fn junior_withdraw(e: Env, amount: i128) -> Result<(), Error> {
        let treasury = require_role(&e, DataKey::Treasury);
        positive(amount)?;
        let (p, mut book) = load_accrued(&e);
        if amount > book.junior_assets {
            return Err(Error::ExceedsMaximum);
        }
        if amount > acc::lendable(pool_cash(&e, &book), &book) {
            return Err(Error::InsufficientLiquidity);
        }
        let after = book.junior_assets - amount;
        if acc::total_debt(&e, &book) > (p.max_leverage as i128) * after {
            return Err(Error::LeverageCapExceeded);
        }
        book.junior_assets = after;
        book.save(&e);
        asset(&e).transfer(&e.current_contract_address(), &treasury, &amount);
        JuniorWithdraw { amount }.publish(&e);
        Ok(())
    }

    pub fn claim_fees(e: Env, amount: i128) -> Result<(), Error> {
        let treasury = require_role(&e, DataKey::Treasury);
        positive(amount)?;
        let (_, mut book) = load_accrued(&e);
        if amount > book.fees_accrued.min(pool_cash(&e, &book)) {
            return Err(Error::ExceedsMaximum);
        }
        book.fees_accrued -= amount;
        book.save(&e);
        asset(&e).transfer(&e.current_contract_address(), &treasury, &amount);
        FeesClaimed { amount }.publish(&e);
        Ok(())
    }

    // ============================================================ helper views

    pub fn config(e: Env) -> PoolConfig {
        PoolConfig {
            admin: storage::get_addr(&e, &DataKey::Admin),
            operator: storage::get_addr(&e, &DataKey::Operator),
            treasury: storage::get_addr(&e, &DataKey::Treasury),
            card_settlement: storage::get_addr(&e, &DataKey::CardSettlement),
            asset: storage::get_addr(&e, &DataKey::Asset),
            note_contract: storage::get_addr(&e, &DataKey::NoteContract),
        }
    }

    pub fn demo_offset(e: Env) -> u64 {
        Book::load(&e).demo_offset
    }

    pub fn draw_used(e: Env, auth_ref: BytesN<32>) -> bool {
        storage::draw_used(&e, &auth_ref)
    }
}

// ------------------------------------------------------------------ SEP-41 share token (eaSR)

#[contractimpl(contracttrait)]
impl FungibleToken for AdvancePool {
    type ContractType = Base;
}

#[contractimpl(contracttrait)]
impl FungibleBurnable for AdvancePool {
    /// Burning shares is allowed (SEP-41) and keeps the supply counter exact;
    /// the burned claim accrues to the remaining holders.
    fn burn(e: &Env, from: Address, amount: i128) {
        Base::burn(e, &from, amount);
        let mut book = Book::load(e);
        book.share_supply = sub(e, book.share_supply, amount);
        book.save(e);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        Base::burn_from(e, &spender, &from, amount);
        let mut book = Book::load(e);
        book.share_supply = sub(e, book.share_supply, amount);
        book.save(e);
    }
}

#[cfg(test)]
mod test;
