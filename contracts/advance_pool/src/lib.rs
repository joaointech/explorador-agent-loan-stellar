//! advance_pool (spec §7.3): the senior vault (SEP-56 over the eaSR SEP-41
//! share token), per-note credit lines, card draws, settlement, cancellation
//! and write-offs, with the economic model of spec §5.
//!
//! Every state-changing entry point accrues interest first (`Pool::current`
//! + `save`); views compute the same accrual in memory without saving it.
#![no_std]

mod events;
mod pool;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use events::{
    BalanceWithdrawn, CardDraw, CardEnabled, ClockAdvanced, DebtWrittenOff, FeesClaimed,
    JuniorDeposit, JuniorWithdraw, LineOpened, NoteCancelled, NoteSettled,
};
pub use types::{
    AgentPosition, AgentState, DrawResult, Line, LineStatus, LineView, Params, PoolStats,
};

use advance_shared::{
    interfaces::NoteClient,
    math::{self, mul_div_ceil, mul_div_floor, BPS, SCALE},
    Error, Note, NoteStatus,
};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, token::TokenClient, Address, BytesN, Env,
    MuxedAddress, String, Vec,
};
use stellar_tokens::{
    fungible::{
        burnable::FungibleBurnable,
        total_supply::{self as supply, FungibleTotalSupply, TotalSupply},
        Base, ContractOverrides, FungibleToken,
    },
    vault::{emit_deposit, emit_withdraw},
};

use crate::{pool::Pool, storage::DataKey};

/// eaSR has 7 decimals, like tEURC.
pub const SHARE_DECIMALS: u32 = 7;
/// `advance_clock` moves the protocol clock by at most 400 days per call.
pub const MAX_CLOCK_ADVANCE_SECS: u64 = 400 * 86_400;

#[contract]
pub struct AdvancePool;

#[contractimpl]
impl AdvancePool {
    #[allow(clippy::too_many_arguments)]
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
        if i128::from(params.protocol_fee_bps) > BPS
            || i128::from(params.ltv_bps) > BPS
            || params.max_leverage == 0
        {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        storage::set_instance(&e, &DataKey::Admin, &admin);
        storage::set_instance(&e, &DataKey::Operator, &operator);
        storage::set_instance(&e, &DataKey::Treasury, &treasury);
        storage::set_instance(&e, &DataKey::CardSettlement, &card_settlement);
        storage::set_instance(&e, &DataKey::Asset, &asset);
        storage::set_instance(&e, &DataKey::NoteContract, &note_contract);
        storage::set_instance(&e, &DataKey::Params, &params);
        Pool::new(&e, params).save(&e);
        Base::set_metadata(
            &e,
            SHARE_DECIMALS,
            String::from_str(&e, "explorador advance Senior"),
            String::from_str(&e, "eaSR"),
        );
        storage::bump_instance(&e);
    }

    // ------------------------------------------------------------ SEP-56 vault

    /// The underlying asset (tEURC).
    pub fn query_asset(e: Env) -> Address {
        storage::bump_instance(&e);
        storage::asset(&e)
    }

    /// `senior_assets` after accrual: accounting-based, so token donations
    /// cannot move the share price (spec §5.5).
    pub fn total_assets(e: Env) -> Result<i128, Error> {
        Ok(Pool::current(&e)?.senior_assets)
    }

    /// `assets × (supply + 1) / (total_assets + 1)`, rounded down.
    pub fn convert_to_shares(e: Env, assets: i128) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        shares_for(&e, &pool, non_negative(assets)?, Rounding::Down)
    }

    /// `shares × (total_assets + 1) / (supply + 1)`, rounded down.
    pub fn convert_to_assets(e: Env, shares: i128) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        assets_for(&e, &pool, non_negative(shares)?, Rounding::Down)
    }

    pub fn max_deposit(e: Env, _receiver: Address) -> i128 {
        storage::bump_instance(&e);
        i128::MAX
    }

    /// Shares minted by `deposit(assets)`: rounded down.
    pub fn preview_deposit(e: Env, assets: i128) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        shares_for(&e, &pool, non_negative(assets)?, Rounding::Down)
    }

    /// Deposits `assets` from `from` and mints eaSR to `receiver`.
    /// `operator` authorizes; when it is not `from`, it spends `from`'s tEURC
    /// allowance (SEP-56 / OpenZeppelin semantics).
    pub fn deposit(
        e: Env,
        assets: i128,
        receiver: Address,
        from: Address,
        operator: Address,
    ) -> Result<i128, Error> {
        operator.require_auth();
        if assets <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        let shares = shares_for(&e, &pool, assets, Rounding::Down)?;
        if shares <= 0 {
            return Err(Error::InvalidAmount);
        }
        pool.senior_assets = math::add(pool.senior_assets, assets)?;
        pool.save(&e);
        mint_shares(&e, &receiver, shares)?;
        pull_assets(&e, &operator, &from, assets);
        emit_deposit(&e, &operator, &from, &receiver, assets, shares);
        Ok(shares)
    }

    pub fn max_mint(e: Env, _receiver: Address) -> i128 {
        storage::bump_instance(&e);
        i128::MAX
    }

    /// Assets charged by `mint(shares)`: rounded up.
    pub fn preview_mint(e: Env, shares: i128) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        assets_for(&e, &pool, non_negative(shares)?, Rounding::Up)
    }

    /// Mints exactly `shares` to `receiver` for `preview_mint(shares)` assets.
    pub fn mint(
        e: Env,
        shares: i128,
        receiver: Address,
        from: Address,
        operator: Address,
    ) -> Result<i128, Error> {
        operator.require_auth();
        if shares <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        let assets = assets_for(&e, &pool, shares, Rounding::Up)?;
        pool.senior_assets = math::add(pool.senior_assets, assets)?;
        pool.save(&e);
        mint_shares(&e, &receiver, shares)?;
        pull_assets(&e, &operator, &from, assets);
        emit_deposit(&e, &operator, &from, &receiver, assets, shares);
        Ok(assets)
    }

    /// `min(convert_to_assets(balance(owner)), lendable)` (spec §5.5).
    pub fn max_withdraw(e: Env, owner: Address) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        let value = assets_for(&e, &pool, Base::balance(&e, &owner), Rounding::Down)?;
        Ok(value.min(Liquidity::of(&e, &pool)?.lendable))
    }

    /// Shares burned by `withdraw(assets)`: rounded up.
    pub fn preview_withdraw(e: Env, assets: i128) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        shares_for(&e, &pool, non_negative(assets)?, Rounding::Up)
    }

    /// Withdraws exactly `assets` to `receiver`, burning `owner`'s shares.
    /// `operator` authorizes; when it is not `owner`, it spends `owner`'s eaSR
    /// allowance.
    pub fn withdraw(
        e: Env,
        assets: i128,
        receiver: Address,
        owner: Address,
        operator: Address,
    ) -> Result<i128, Error> {
        operator.require_auth();
        if assets <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        let owned = Base::balance(&e, &owner);
        if assets > assets_for(&e, &pool, owned, Rounding::Down)? {
            return Err(Error::InvalidAmount);
        }
        if assets > Liquidity::of(&e, &pool)?.lendable {
            return Err(Error::InsufficientLiquidity);
        }
        // ≤ owned, because assets ≤ floor(owned × (T + 1) / (N + 1)).
        let shares = shares_for(&e, &pool, assets, Rounding::Up)?;
        pool.senior_assets = math::sub(pool.senior_assets, assets)?;
        pool.save(&e);
        burn_shares(&e, &owner, &operator, shares);
        token(&e).transfer(&e.current_contract_address(), &receiver, &assets);
        emit_withdraw(&e, &operator, &receiver, &owner, assets, shares);
        Ok(shares)
    }

    /// `owner`'s shares, capped by what the lendable cash can pay out.
    pub fn max_redeem(e: Env, owner: Address) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        let lendable = Liquidity::of(&e, &pool)?.lendable;
        let shares =
            Base::balance(&e, &owner).min(shares_for(&e, &pool, lendable, Rounding::Down)?);
        // `redeem` rejects burning shares for zero assets.
        if assets_for(&e, &pool, shares, Rounding::Down)? == 0 {
            return Ok(0);
        }
        Ok(shares)
    }

    /// Assets paid by `redeem(shares)`: rounded down.
    pub fn preview_redeem(e: Env, shares: i128) -> Result<i128, Error> {
        let pool = Pool::current(&e)?;
        assets_for(&e, &pool, non_negative(shares)?, Rounding::Down)
    }

    /// Burns exactly `shares` of `owner` and pays `preview_redeem(shares)` to
    /// `receiver`.
    pub fn redeem(
        e: Env,
        shares: i128,
        receiver: Address,
        owner: Address,
        operator: Address,
    ) -> Result<i128, Error> {
        operator.require_auth();
        if shares <= 0 || shares > Base::balance(&e, &owner) {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        let assets = assets_for(&e, &pool, shares, Rounding::Down)?;
        if assets <= 0 {
            return Err(Error::InvalidAmount);
        }
        if assets > Liquidity::of(&e, &pool)?.lendable {
            return Err(Error::InsufficientLiquidity);
        }
        pool.senior_assets = math::sub(pool.senior_assets, assets)?;
        pool.save(&e);
        burn_shares(&e, &owner, &operator, shares);
        token(&e).transfer(&e.current_contract_address(), &receiver, &assets);
        emit_withdraw(&e, &operator, &receiver, &owner, assets, shares);
        Ok(assets)
    }

    // ------------------------------------------------------------ clock & accounting

    /// Ledger time + demo offset (spec §5.7): the single source of truth for
    /// time, also used by `cpcv_note`.
    pub fn protocol_now(e: Env) -> u64 {
        storage::bump_instance(&e);
        let offset: u64 = storage::get_instance(&e, &DataKey::DemoOffset);
        e.ledger().timestamp().saturating_add(offset)
    }

    /// Demo fast-forward (admin, demo mode only): accrues interest up to now,
    /// then moves the protocol clock forward by `secs` (≤ 400 days).
    pub fn advance_clock(e: Env, secs: u64) -> Result<(), Error> {
        storage::admin(&e).require_auth();
        let mut pool = Pool::current(&e)?;
        if !pool.params.demo_mode {
            return Err(Error::DemoModeDisabled);
        }
        if secs == 0 {
            return Err(Error::InvalidAmount);
        }
        if secs > MAX_CLOCK_ADVANCE_SECS {
            return Err(Error::ClockAdvanceTooLarge);
        }
        pool.demo_offset = pool.demo_offset.checked_add(secs).ok_or(Error::Overflow)?;
        let protocol_now = pool.now(&e);
        pool.save(&e);
        ClockAdvanced { secs, protocol_now }.publish(&e);
        Ok(())
    }

    /// Books accrued interest (anyone).
    pub fn accrue(e: Env) -> Result<(), Error> {
        Pool::current(&e)?.save(&e);
        Ok(())
    }

    pub fn stats(e: Env) -> Result<PoolStats, Error> {
        let pool = Pool::current(&e)?;
        let liquidity = Liquidity::of(&e, &pool)?;
        let share_supply = supply::total_supply(&e);
        let share_price_scaled = mul_div_floor(
            &e,
            math::add(pool.senior_assets, 1)?,
            SCALE,
            math::add(share_supply, 1)?,
        )?;
        let utilization_bps = ratio(
            &e,
            liquidity.total_debt,
            BPS,
            math::add(liquidity.total_debt, liquidity.lendable)?,
        )?;
        let leverage_x100 = if pool.junior_assets > 0 {
            ratio(&e, liquidity.total_debt, 100, pool.junior_assets)?
        } else if liquidity.total_debt > 0 {
            u32::MAX
        } else {
            0
        };
        Ok(PoolStats {
            senior_assets: pool.senior_assets,
            junior_assets: pool.junior_assets,
            fees_accrued: pool.fees_accrued,
            total_debt: liquidity.total_debt,
            total_principal: pool.total_principal,
            pool_cash: liquidity.pool_cash,
            total_card_balances: pool.total_card_balances,
            share_supply,
            share_price_scaled,
            utilization_bps,
            leverage_x100,
            lendable: liquidity.lendable,
            leverage_headroom: liquidity.leverage_headroom,
            borrow_index: pool.borrow_index,
            protocol_now: pool.now(&e),
            params: pool.params,
            written_off_total: pool.written_off_total,
        })
    }

    pub fn params(e: Env) -> Params {
        storage::bump_instance(&e);
        storage::get_instance(&e, &DataKey::Params)
    }

    // ------------------------------------------------------------ credit lines

    /// Opens the credit line of a freshly minted note. Only the note contract
    /// can call it (it is the direct invoker during `cpcv_note.mint`). The
    /// note comes by value: Soroban forbids re-entering `cpcv_note.get`.
    pub fn open_line(e: Env, note: Note) -> Result<(), Error> {
        storage::note_contract(&e).require_auth();
        let pool = Pool::current(&e)?;
        if storage::line(&e, note.id).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        if note.status != NoteStatus::Active {
            return Err(Error::LineNotActive);
        }
        check_split(&note)?;
        let credit_limit = mul_div_floor(
            &e,
            note.agent_commission,
            i128::from(pool.params.ltv_bps),
            BPS,
        )?;
        let line = Line {
            note_id: note.id,
            agent: note.agent.clone(),
            credit_limit,
            principal: 0,
            scaled_debt: 0,
            escritura_day: note.escritura_day,
            status: LineStatus::Active,
        };
        let mut agent = storage::agent(&e, &note.agent);
        insert_line_sorted(&e, &mut agent.active_lines, &line)?;
        storage::set_line(&e, &line);
        storage::set_agent(&e, &note.agent, &agent);
        pool.save(&e);
        LineOpened {
            note_id: note.id,
            agent: note.agent,
            credit_limit,
        }
        .publish(&e);
        Ok(())
    }

    pub fn line(e: Env, note_id: u32) -> Result<LineView, Error> {
        let pool = Pool::current(&e)?;
        line_view(&e, &pool, storage::line_or_err(&e, note_id)?)
    }

    pub fn agent_position(e: Env, agent: Address) -> Result<AgentPosition, Error> {
        let pool = Pool::current(&e)?;
        let state = storage::agent(&e, &agent);
        let credit = Credit::of(&e, &pool, &state)?;
        let mut total_debt = credit.carried_debt;
        let mut total_principal = state.carried_principal;
        for view in credit.lines.iter() {
            total_debt = math::add(total_debt, view.debt)?;
            total_principal = math::add(total_principal, view.line.principal)?;
        }
        let borrowable_now = if credit.available > 0 {
            let liquidity = Liquidity::of(&e, &pool)?;
            credit
                .available
                .min(liquidity.lendable)
                .min(liquidity.leverage_headroom)
        } else {
            0
        };
        Ok(AgentPosition {
            card_balance: state.card_balance,
            card_enabled: state.card_enabled,
            blocked: state.blocked,
            lines: credit.lines,
            carried_debt: credit.carried_debt,
            grace_deadline: state.grace_deadline,
            total_debt,
            total_principal,
            available_credit: credit.available,
            borrowable_now,
        })
    }

    // ------------------------------------------------------------ card

    /// The agent's on-chain consent (passkey) for the operator to draw on
    /// their behalf when they use the card.
    pub fn enable_card(e: Env, agent: Address) -> Result<(), Error> {
        set_card(&e, agent, true)
    }

    pub fn disable_card(e: Env, agent: Address) -> Result<(), Error> {
        set_card(&e, agent, false)
    }

    /// Funds a card purchase (operator): card balance first, then credit from
    /// the active lines, earliest escritura first. Sends `amount` to the card
    /// settlement account. `auth_ref` (the card authorization) can be used
    /// once.
    pub fn card_draw(
        e: Env,
        agent: Address,
        amount: i128,
        auth_ref: BytesN<32>,
    ) -> Result<DrawResult, Error> {
        storage::operator(&e).require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        if storage::draw_recorded(&e, &auth_ref) {
            return Err(Error::DuplicateDraw);
        }
        let mut state = storage::agent(&e, &agent);
        if !state.card_enabled {
            return Err(Error::CardNotEnabled);
        }
        let from_balance = state.card_balance.min(amount);
        let from_credit = amount - from_balance;
        if from_credit > 0 {
            if state.blocked {
                return Err(Error::AgentBlocked);
            }
            let credit = Credit::of(&e, &pool, &state)?;
            if from_credit > credit.available {
                return Err(Error::InsufficientCredit);
            }
            let liquidity = Liquidity::of(&e, &pool)?;
            if from_credit > liquidity.lendable {
                return Err(Error::InsufficientLiquidity);
            }
            if from_credit > liquidity.leverage_headroom {
                return Err(Error::LeverageCapExceeded);
            }
            let mut remaining = from_credit;
            for view in credit.lines.iter() {
                if remaining == 0 {
                    break;
                }
                let take = view.available.min(remaining);
                if take == 0 {
                    continue;
                }
                let scaled = pool.scaled_for_borrow(&e, take)?;
                let mut line = view.line;
                line.scaled_debt = math::add(line.scaled_debt, scaled)?;
                line.principal = math::add(line.principal, take)?;
                storage::set_line(&e, &line);
                pool.total_scaled_debt = math::add(pool.total_scaled_debt, scaled)?;
                pool.total_principal = math::add(pool.total_principal, take)?;
                remaining -= take;
            }
            // Unreachable: available credit never exceeds the lines' room.
            if remaining > 0 {
                return Err(Error::InsufficientCredit);
            }
            pool.book_rounding(&e, liquidity.total_debt, -from_credit)?;
        }
        state.card_balance -= from_balance;
        pool.total_card_balances = math::sub(pool.total_card_balances, from_balance)?;
        storage::set_agent(&e, &agent, &state);
        storage::record_draw(&e, &auth_ref);
        pool.save(&e);
        token(&e).transfer(
            &e.current_contract_address(),
            storage::card_settlement(&e),
            &amount,
        );
        CardDraw {
            agent,
            amount,
            from_balance,
            from_credit,
            auth_ref,
        }
        .publish(&e);
        Ok(DrawResult {
            from_balance,
            from_credit,
        })
    }

    /// The agent withdraws card balance to any address (passkey).
    pub fn withdraw_balance(
        e: Env,
        agent: Address,
        amount: i128,
        to: Address,
    ) -> Result<(), Error> {
        agent.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        let mut state = storage::agent(&e, &agent);
        if amount > state.card_balance {
            return Err(Error::InvalidAmount);
        }
        state.card_balance -= amount;
        pool.total_card_balances = math::sub(pool.total_card_balances, amount)?;
        storage::set_agent(&e, &agent, &state);
        pool.save(&e);
        token(&e).transfer(&e.current_contract_address(), &to, &amount);
        BalanceWithdrawn { agent, amount, to }.publish(&e);
        Ok(())
    }

    // ------------------------------------------------------------ deal outcomes

    /// Escritura (operator + treasury): pulls the total commission from the
    /// treasury, repays the line, then carried debt, credits the rest of the
    /// agent's half to the card balance and explorador's half to the junior
    /// tranche. If the line debt exceeds the agent's half, the shortfall
    /// becomes carried debt.
    pub fn settle(e: Env, note_id: u32) -> Result<(), Error> {
        storage::operator(&e).require_auth();
        let treasury = storage::treasury(&e);
        treasury.require_auth();
        let mut pool = Pool::current(&e)?;
        let mut line = storage::line_or_err(&e, note_id)?;
        if line.status != LineStatus::Active {
            return Err(Error::LineNotActive);
        }
        let notes = NoteClient::new(&e, &storage::note_contract(&e));
        let note = notes.get(&note_id);
        if note.agent != line.agent {
            return Err(Error::UnknownNote);
        }
        check_split(&note)?;
        let agent = line.agent.clone();
        let mut state = storage::agent(&e, &agent);
        let now = pool.now(&e);

        let debt_before = pool.total_debt(&e)?;
        let debt = pool.debt_of(&e, line.scaled_debt)?;
        let half = note.agent_commission;
        let line_interest = (debt - line.principal).max(0);
        let (debt_repaid, interest_paid, carried_repaid, agent_payout);
        if half >= debt {
            // The agent's half covers the line; what is left repays carried
            // debt, and the remainder is paid out.
            pool.total_scaled_debt = math::sub(pool.total_scaled_debt, line.scaled_debt)?;
            pool.total_principal = math::sub(pool.total_principal, line.principal)?;
            debt_repaid = debt;
            interest_paid = line_interest;
            let left = half - debt;
            let carried_debt = pool.debt_of(&e, state.carried_scaled)?;
            carried_repaid = left.min(carried_debt);
            if carried_repaid > 0 {
                repay_carried(&e, &mut pool, &mut state, carried_repaid, carried_debt)?;
            }
            agent_payout = left - carried_repaid;
        } else {
            // Shortfall: the whole half repays the line (interest first) and
            // the rest of the line debt becomes carried debt.
            let (removed, principal_repaid) =
                partial_repayment(&e, &pool, line.scaled_debt, line.principal, debt, half)?;
            pool.total_scaled_debt = math::sub(pool.total_scaled_debt, removed)?;
            pool.total_principal = math::sub(pool.total_principal, principal_repaid)?;
            state.carried_scaled = math::add(state.carried_scaled, line.scaled_debt - removed)?;
            state.carried_principal =
                math::add(state.carried_principal, line.principal - principal_repaid)?;
            debt_repaid = half;
            interest_paid = half.min(line_interest);
            carried_repaid = 0;
            agent_payout = 0;
        }
        // The pool keeps `debt_repaid + carried_repaid` of the agent's half.
        pool.book_rounding(&e, debt_before, half - agent_payout)?;
        state.card_balance = math::add(state.card_balance, agent_payout)?;
        pool.total_card_balances = math::add(pool.total_card_balances, agent_payout)?;
        pool.junior_assets = math::add(pool.junior_assets, note.explorador_commission)?;

        line.scaled_debt = 0;
        line.principal = 0;
        line.status = LineStatus::Settled;
        remove_active(&mut state.active_lines, note_id);
        update_grace(&pool, &mut state, now)?;
        storage::set_line(&e, &line);
        storage::set_agent(&e, &agent, &state);
        pool.save(&e);

        token(&e).transfer(
            &treasury,
            e.current_contract_address(),
            &note.total_commission,
        );
        notes.set_status(&note_id, &NoteStatus::Settled);
        NoteSettled {
            note_id,
            agent,
            total_commission: note.total_commission,
            debt_repaid,
            interest_paid,
            carried_repaid,
            agent_payout,
            junior_deposit: note.explorador_commission,
        }
        .publish(&e);
        Ok(())
    }

    /// The buyer walked away (operator): the line debt moves to the agent's
    /// carried debt, the card balance repays it as far as possible, and the
    /// grace period starts (if not already running).
    pub fn cancel(e: Env, note_id: u32) -> Result<(), Error> {
        storage::operator(&e).require_auth();
        let mut pool = Pool::current(&e)?;
        let mut line = storage::line_or_err(&e, note_id)?;
        if line.status != LineStatus::Active {
            return Err(Error::LineNotActive);
        }
        let agent = line.agent.clone();
        let mut state = storage::agent(&e, &agent);
        let now = pool.now(&e);

        let debt_carried = pool.debt_of(&e, line.scaled_debt)?;
        state.carried_scaled = math::add(state.carried_scaled, line.scaled_debt)?;
        state.carried_principal = math::add(state.carried_principal, line.principal)?;
        line.scaled_debt = 0;
        line.principal = 0;
        line.status = LineStatus::Cancelled;
        remove_active(&mut state.active_lines, note_id);

        let carried_debt = pool.debt_of(&e, state.carried_scaled)?;
        let repaid = state.card_balance.min(carried_debt);
        if repaid > 0 {
            let debt_before = pool.total_debt(&e)?;
            repay_carried(&e, &mut pool, &mut state, repaid, carried_debt)?;
            state.card_balance -= repaid;
            pool.total_card_balances = math::sub(pool.total_card_balances, repaid)?;
            pool.book_rounding(&e, debt_before, repaid)?;
        }
        update_grace(&pool, &mut state, now)?;
        storage::set_line(&e, &line);
        storage::set_agent(&e, &agent, &state);
        pool.save(&e);

        NoteClient::new(&e, &storage::note_contract(&e))
            .set_status(&note_id, &NoteStatus::Cancelled);
        NoteCancelled {
            note_id,
            agent,
            debt_carried,
            grace_deadline: state.grace_deadline,
        }
        .publish(&e);
        Ok(())
    }

    /// After the grace deadline (operator): removes the agent's carried debt
    /// from the book, junior tranche first, then senior, and blocks the agent.
    pub fn write_off(e: Env, agent: Address) -> Result<(), Error> {
        storage::operator(&e).require_auth();
        let mut pool = Pool::current(&e)?;
        let mut state = storage::agent(&e, &agent);
        if state.carried_scaled == 0 {
            return Err(Error::NothingToWriteOff);
        }
        let deadline = state.grace_deadline.ok_or(Error::GraceNotOver)?;
        if pool.now(&e) < deadline {
            return Err(Error::GraceNotOver);
        }

        let debt_before = pool.total_debt(&e)?;
        let amount = pool.debt_of(&e, state.carried_scaled)?;
        pool.total_scaled_debt = math::sub(pool.total_scaled_debt, state.carried_scaled)?;
        pool.total_principal = math::sub(pool.total_principal, state.carried_principal)?;
        // The book debt falls by `booked` (≤ amount, as debts round up); the
        // tranches absorb exactly that, so the §5.3 invariant stays exact.
        let booked = math::sub(debt_before, pool.total_debt(&e)?)?;
        let junior_loss = booked.min(pool.junior_assets).max(0);
        let senior_loss = (booked - junior_loss).min(pool.senior_assets).max(0);
        // Only when both tranches are exhausted (fees accrued but not backed
        // by cash): the rest reduces explorador's unclaimed fees.
        let fee_loss = booked - junior_loss - senior_loss;
        pool.junior_assets -= junior_loss;
        pool.senior_assets -= senior_loss;
        pool.fees_accrued = math::sub(pool.fees_accrued, fee_loss)?;

        state.carried_scaled = 0;
        state.carried_principal = 0;
        state.grace_deadline = None;
        state.blocked = true;
        state.written_off_total = math::add(state.written_off_total, amount)?;
        pool.written_off_total = math::add(pool.written_off_total, amount)?;
        storage::set_agent(&e, &agent, &state);
        pool.save(&e);
        DebtWrittenOff {
            agent,
            amount,
            junior_loss,
            senior_loss,
        }
        .publish(&e);
        Ok(())
    }

    /// Blocks or unblocks new credit for an agent (operator).
    pub fn set_blocked(e: Env, agent: Address, blocked: bool) -> Result<(), Error> {
        storage::operator(&e).require_auth();
        let pool = Pool::current(&e)?;
        let mut state = storage::agent(&e, &agent);
        state.blocked = blocked;
        storage::set_agent(&e, &agent, &state);
        pool.save(&e);
        Ok(())
    }

    // ------------------------------------------------------------ junior tranche & fees

    /// explorador's first-loss capital (treasury).
    pub fn junior_deposit(e: Env, amount: i128) -> Result<(), Error> {
        let treasury = storage::treasury(&e);
        treasury.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        pool.junior_assets = math::add(pool.junior_assets, amount)?;
        pool.save(&e);
        token(&e).transfer(&treasury, e.current_contract_address(), &amount);
        JuniorDeposit { amount }.publish(&e);
        Ok(())
    }

    /// Treasury withdrawal from the junior tranche: amount ≤ junior assets,
    /// ≤ lendable, and the leverage cap must still hold afterwards.
    pub fn junior_withdraw(e: Env, amount: i128) -> Result<(), Error> {
        let treasury = storage::treasury(&e);
        treasury.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        if amount > pool.junior_assets {
            return Err(Error::InvalidAmount);
        }
        let liquidity = Liquidity::of(&e, &pool)?;
        if amount > liquidity.lendable {
            return Err(Error::InsufficientLiquidity);
        }
        let junior_after = pool.junior_assets - amount;
        if liquidity.total_debt > math::mul(i128::from(pool.params.max_leverage), junior_after)? {
            return Err(Error::LeverageCapExceeded);
        }
        pool.junior_assets = junior_after;
        pool.save(&e);
        token(&e).transfer(&e.current_contract_address(), &treasury, &amount);
        JuniorWithdraw { amount }.publish(&e);
        Ok(())
    }

    /// Protocol fees to the treasury: amount ≤ min(fees_accrued, pool_cash).
    pub fn claim_fees(e: Env, amount: i128) -> Result<(), Error> {
        let treasury = storage::treasury(&e);
        treasury.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut pool = Pool::current(&e)?;
        if amount > pool.fees_accrued {
            return Err(Error::InvalidAmount);
        }
        if amount > Liquidity::of(&e, &pool)?.pool_cash {
            return Err(Error::InsufficientLiquidity);
        }
        pool.fees_accrued -= amount;
        pool.save(&e);
        token(&e).transfer(&e.current_contract_address(), &treasury, &amount);
        FeesClaimed { amount }.publish(&e);
        Ok(())
    }
}

// ---------------------------------------------------------------- SEP-41 eaSR share token
//
// OpenZeppelin defaults (`TotalSupply` contract type: `Base` balances plus a
// supply counter, so `burn` keeps the vault's supply right). The wrappers only
// extend TTLs on every call.

#[contractimpl(contracttrait)]
impl FungibleToken for AdvancePool {
    type ContractType = TotalSupply;

    fn balance(e: &Env, account: Address) -> i128 {
        storage::bump_instance(e);
        let balance = <TotalSupply as ContractOverrides>::balance(e, &account);
        storage::bump_share_balance(e, &account);
        balance
    }

    fn allowance(e: &Env, owner: Address, spender: Address) -> i128 {
        storage::bump_instance(e);
        <TotalSupply as ContractOverrides>::allowance(e, &owner, &spender)
    }

    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        storage::bump_instance(e);
        <TotalSupply as ContractOverrides>::transfer(e, &from, &to, amount);
        storage::bump_share_balance(e, &from);
        storage::bump_share_balance(e, &to.address());
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        storage::bump_instance(e);
        <TotalSupply as ContractOverrides>::transfer_from(e, &spender, &from, &to, amount);
        storage::bump_share_balance(e, &from);
        storage::bump_share_balance(e, &to);
    }

    fn approve(e: &Env, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        storage::bump_instance(e);
        <TotalSupply as ContractOverrides>::approve(e, &owner, &spender, amount, live_until_ledger);
    }

    fn decimals(e: &Env) -> u32 {
        storage::bump_instance(e);
        <TotalSupply as ContractOverrides>::decimals(e)
    }

    fn name(e: &Env) -> String {
        storage::bump_instance(e);
        <TotalSupply as ContractOverrides>::name(e)
    }

    fn symbol(e: &Env) -> String {
        storage::bump_instance(e);
        <TotalSupply as ContractOverrides>::symbol(e)
    }
}

#[contractimpl(contracttrait)]
impl FungibleTotalSupply for AdvancePool {
    fn total_supply(e: &Env) -> i128 {
        storage::bump_instance(e);
        supply::total_supply(e)
    }
}

/// Burning eaSR gives up the shares' value to the remaining holders.
#[contractimpl(contracttrait)]
impl FungibleBurnable for AdvancePool {
    fn burn(e: &Env, from: Address, amount: i128) {
        storage::bump_instance(e);
        TotalSupply::burn(e, &from, amount);
        storage::bump_share_balance(e, &from);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        storage::bump_instance(e);
        TotalSupply::burn_from(e, &spender, &from, amount);
        storage::bump_share_balance(e, &from);
    }
}

// ---------------------------------------------------------------- helpers

fn token(e: &Env) -> TokenClient<'_> {
    TokenClient::new(e, &storage::asset(e))
}

#[derive(Clone, Copy)]
enum Rounding {
    Down,
    Up,
}

fn mul_div(e: &Env, x: i128, y: i128, d: i128, rounding: Rounding) -> Result<i128, Error> {
    match rounding {
        Rounding::Down => mul_div_floor(e, x, y, d),
        Rounding::Up => mul_div_ceil(e, x, y, d),
    }
}

/// `assets × (supply + 1) / (senior_assets + 1)` (spec §5.5).
fn shares_for(e: &Env, pool: &Pool, assets: i128, rounding: Rounding) -> Result<i128, Error> {
    let supply = supply::total_supply(e);
    mul_div(
        e,
        assets,
        math::add(supply, 1)?,
        math::add(pool.senior_assets, 1)?,
        rounding,
    )
}

/// `shares × (senior_assets + 1) / (supply + 1)` (spec §5.5).
fn assets_for(e: &Env, pool: &Pool, shares: i128, rounding: Rounding) -> Result<i128, Error> {
    let supply = supply::total_supply(e);
    mul_div(
        e,
        shares,
        math::add(pool.senior_assets, 1)?,
        math::add(supply, 1)?,
        rounding,
    )
}

fn non_negative(amount: i128) -> Result<i128, Error> {
    if amount < 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(amount)
}

fn mint_shares(e: &Env, to: &Address, shares: i128) -> Result<(), Error> {
    // Conversions use `supply + 1`, so keep that sum representable.
    math::add(math::add(supply::total_supply(e), shares)?, 1)?;
    supply::increase_total_supply(e, shares);
    Base::update(e, None, Some(to), shares);
    storage::bump_share_balance(e, to);
    Ok(())
}

fn burn_shares(e: &Env, owner: &Address, operator: &Address, shares: i128) {
    if operator != owner {
        Base::spend_allowance(e, owner, operator, shares);
    }
    Base::update(e, Some(owner), None, shares);
    supply::decrease_total_supply(e, shares);
    storage::bump_share_balance(e, owner);
}

/// Moves `assets` of tEURC from `from` into the pool: a direct transfer when
/// the operator is `from`, otherwise through `from`'s allowance to `operator`.
fn pull_assets(e: &Env, operator: &Address, from: &Address, assets: i128) {
    let pool = e.current_contract_address();
    if operator == from {
        token(e).transfer(from, &pool, &assets);
    } else {
        token(e).transfer_from(operator, from, &pool, &assets);
    }
}

/// `x × scale / d` as a u32 (clamped), 0 when `d == 0`.
fn ratio(e: &Env, x: i128, scale: i128, d: i128) -> Result<u32, Error> {
    if d <= 0 {
        return Ok(0);
    }
    let r = mul_div_floor(e, x.max(0), scale, d)?;
    Ok(u32::try_from(r).unwrap_or(u32::MAX))
}

/// The note's split must be consistent (cpcv_note guarantees it).
fn check_split(note: &Note) -> Result<(), Error> {
    if note.total_commission <= 0
        || note.agent_commission < 0
        || note.explorador_commission < 0
        || math::add(note.agent_commission, note.explorador_commission)? != note.total_commission
    {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}

/// Pool cash and the §5.4 liquidity limits.
struct Liquidity {
    /// asset.balance(pool) − total_card_balances.
    pool_cash: i128,
    total_debt: i128,
    lendable: i128,
    leverage_headroom: i128,
}

impl Liquidity {
    fn of(e: &Env, pool: &Pool) -> Result<Self, Error> {
        let balance = token(e).balance(&e.current_contract_address());
        let pool_cash = math::sub(balance, pool.total_card_balances)?;
        let total_debt = pool.total_debt(e)?;
        Ok(Liquidity {
            pool_cash,
            total_debt,
            lendable: pool.lendable(pool_cash),
            leverage_headroom: pool.leverage_headroom(total_debt)?,
        })
    }
}

/// An agent's active lines (in draw order) and available credit (§5.4).
struct Credit {
    lines: Vec<LineView>,
    carried_debt: i128,
    /// blocked ? 0 : max(0, Σ line available − carried debt).
    available: i128,
}

impl Credit {
    fn of(e: &Env, pool: &Pool, state: &AgentState) -> Result<Self, Error> {
        let mut lines = Vec::new(e);
        let mut line_available: i128 = 0;
        for id in state.active_lines.iter() {
            let view = line_view(e, pool, storage::line_or_err(e, id)?)?;
            line_available = math::add(line_available, view.available)?;
            lines.push_back(view);
        }
        let carried_debt = pool.debt_of(e, state.carried_scaled)?;
        let available = if state.blocked {
            0
        } else {
            (line_available - carried_debt).max(0)
        };
        Ok(Credit {
            lines,
            carried_debt,
            available,
        })
    }
}

fn line_view(e: &Env, pool: &Pool, line: Line) -> Result<LineView, Error> {
    let debt = pool.debt_of(e, line.scaled_debt)?;
    let interest = (debt - line.principal).max(0);
    let available = if line.status == LineStatus::Active {
        (line.credit_limit - debt).max(0)
    } else {
        0
    };
    Ok(LineView {
        line,
        debt,
        interest,
        available,
    })
}

/// Keeps `active` ordered by (escritura_day, note_id): the draw order.
fn insert_line_sorted(e: &Env, active: &mut Vec<u32>, line: &Line) -> Result<(), Error> {
    let mut at = active.len();
    for (i, id) in (0_u32..).zip(active.iter()) {
        let other = storage::line_or_err(e, id)?;
        if (line.escritura_day, line.note_id) < (other.escritura_day, other.note_id) {
            at = i;
            break;
        }
    }
    active.insert(at, line.note_id);
    Ok(())
}

fn remove_active(active: &mut Vec<u32>, note_id: u32) {
    if let Some(i) = active.first_index_of(note_id) {
        active.remove(i);
    }
}

/// Repaying `amount` (< `debt`) of a position, interest first. Returns the
/// scaled debt removed (rounded down) and the principal repaid.
fn partial_repayment(
    e: &Env,
    pool: &Pool,
    scaled: i128,
    principal: i128,
    debt: i128,
    amount: i128,
) -> Result<(i128, i128), Error> {
    let removed = pool.scaled_for_repayment(e, amount)?.min(scaled);
    let interest_due = (debt - principal).max(0);
    let principal_repaid = (amount - interest_due).max(0).min(principal);
    Ok((removed, principal_repaid))
}

/// Repays `amount` (≤ `carried_debt`) of the agent's carried debt.
fn repay_carried(
    e: &Env,
    pool: &mut Pool,
    state: &mut AgentState,
    amount: i128,
    carried_debt: i128,
) -> Result<(), Error> {
    let (removed, principal_repaid) = if amount >= carried_debt {
        (state.carried_scaled, state.carried_principal)
    } else {
        partial_repayment(
            e,
            pool,
            state.carried_scaled,
            state.carried_principal,
            carried_debt,
            amount,
        )?
    };
    state.carried_scaled -= removed;
    state.carried_principal -= principal_repaid;
    pool.total_scaled_debt = math::sub(pool.total_scaled_debt, removed)?;
    pool.total_principal = math::sub(pool.total_principal, principal_repaid)?;
    Ok(())
}

/// Carried debt always has a grace deadline; it is cleared once repaid.
fn update_grace(pool: &Pool, state: &mut AgentState, now: u64) -> Result<(), Error> {
    if state.carried_scaled == 0 {
        state.grace_deadline = None;
    } else if state.grace_deadline.is_none() {
        state.grace_deadline = Some(
            now.checked_add(pool.params.grace_period_secs)
                .ok_or(Error::Overflow)?,
        );
    }
    Ok(())
}

fn set_card(e: &Env, agent: Address, enabled: bool) -> Result<(), Error> {
    agent.require_auth();
    let pool = Pool::current(e)?;
    let mut state = storage::agent(e, &agent);
    state.card_enabled = enabled;
    storage::set_agent(e, &agent, &state);
    pool.save(e);
    CardEnabled { agent, enabled }.publish(e);
    Ok(())
}
