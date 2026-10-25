//! Pool accounting (spec §5.2 – §5.4): one global borrow index, the senior /
//! junior / fee buckets and the interest waterfall.
//!
//! Core invariant (spec §5.3), kept exact (see `book_rounding`):
//! `senior_assets + junior_assets + fees_accrued == pool_cash + total_debt`.

use advance_shared::{
    math::{self, mul_div_ceil, mul_div_floor, BPS, SCALE, YEAR},
    Error,
};
use soroban_sdk::Env;

use crate::{
    storage::{self, DataKey},
    types::Params,
};

/// The instance-stored accounting. `Pool::current` loads it and accrues it to
/// the protocol clock in memory; state-changing entry points then `save` it,
/// views just drop it (the non-mutating preview of spec §5.2).
pub struct Pool {
    pub params: Params,
    pub demo_offset: u64,
    pub last_accrual: u64,
    pub borrow_index: i128,
    pub total_scaled_debt: i128,
    pub total_principal: i128,
    pub senior_assets: i128,
    pub junior_assets: i128,
    pub fees_accrued: i128,
    pub total_card_balances: i128,
    pub written_off_total: i128,
}

impl Pool {
    /// Fresh accounting at deploy: index = SCALE, everything else zero.
    pub fn new(e: &Env, params: Params) -> Self {
        Pool {
            params,
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
        }
    }

    pub fn load(e: &Env) -> Self {
        Pool {
            params: storage::get_instance(e, &DataKey::Params),
            demo_offset: storage::get_instance(e, &DataKey::DemoOffset),
            last_accrual: storage::get_instance(e, &DataKey::LastAccrual),
            borrow_index: storage::get_instance(e, &DataKey::BorrowIndex),
            total_scaled_debt: storage::get_instance(e, &DataKey::TotalScaledDebt),
            total_principal: storage::get_instance(e, &DataKey::TotalPrincipal),
            senior_assets: storage::get_instance(e, &DataKey::SeniorAssets),
            junior_assets: storage::get_instance(e, &DataKey::JuniorAssets),
            fees_accrued: storage::get_instance(e, &DataKey::FeesAccrued),
            total_card_balances: storage::get_instance(e, &DataKey::TotalCardBalances),
            written_off_total: storage::get_instance(e, &DataKey::WrittenOffTotal),
        }
    }

    /// Persists the clock and accounting (params are immutable and written
    /// once by the constructor).
    pub fn save(&self, e: &Env) {
        storage::set_instance(e, &DataKey::DemoOffset, &self.demo_offset);
        storage::set_instance(e, &DataKey::LastAccrual, &self.last_accrual);
        storage::set_instance(e, &DataKey::BorrowIndex, &self.borrow_index);
        storage::set_instance(e, &DataKey::TotalScaledDebt, &self.total_scaled_debt);
        storage::set_instance(e, &DataKey::TotalPrincipal, &self.total_principal);
        storage::set_instance(e, &DataKey::SeniorAssets, &self.senior_assets);
        storage::set_instance(e, &DataKey::JuniorAssets, &self.junior_assets);
        storage::set_instance(e, &DataKey::FeesAccrued, &self.fees_accrued);
        storage::set_instance(e, &DataKey::TotalCardBalances, &self.total_card_balances);
        storage::set_instance(e, &DataKey::WrittenOffTotal, &self.written_off_total);
    }

    /// Loads the accounting and accrues it to `protocol_now` (in memory).
    pub fn current(e: &Env) -> Result<Self, Error> {
        storage::bump_instance(e);
        let mut pool = Self::load(e);
        let now = pool.now(e);
        pool.accrue(e, now)?;
        Ok(pool)
    }

    /// Protocol clock: ledger time + demo offset (spec §5.7).
    pub fn now(&self, e: &Env) -> u64 {
        e.ledger().timestamp().saturating_add(self.demo_offset)
    }

    /// Spec §5.2 `accrue()`, verbatim: simple interest over `dt` on the
    /// borrow index; the new interest is split into the protocol fee, the
    /// senior tranche (up to its target APY) and the junior tranche.
    pub fn accrue(&mut self, e: &Env, now: u64) -> Result<(), Error> {
        if now <= self.last_accrual {
            return Ok(());
        }
        let dt = i128::from(now - self.last_accrual);
        let per_year = math::mul(BPS, YEAR)?;

        let old_debt = self.total_debt(e)?;
        let apr_dt = math::mul(i128::from(self.params.agent_apr_bps), dt)?;
        let growth = mul_div_floor(e, self.borrow_index, apr_dt, per_year)?;
        self.borrow_index = math::add(self.borrow_index, growth)?;
        let new_debt = self.total_debt(e)?;

        let interest = math::sub(new_debt, old_debt)?;
        let fee = mul_div_floor(e, interest, i128::from(self.params.protocol_fee_bps), BPS)?;
        let net = math::sub(interest, fee)?;
        let target_dt = math::mul(i128::from(self.params.senior_target_bps), dt)?;
        let senior_due = mul_div_floor(e, self.senior_assets, target_dt, per_year)?;
        let to_senior = net.min(senior_due.max(0));
        let to_junior = math::sub(net, to_senior)?;

        self.fees_accrued = math::add(self.fees_accrued, fee)?;
        self.senior_assets = math::add(self.senior_assets, to_senior)?;
        self.junior_assets = math::add(self.junior_assets, to_junior)?;
        self.last_accrual = now;
        Ok(())
    }

    /// `total_scaled_debt × borrow_index / SCALE`, rounded down (spec §5.3).
    pub fn total_debt(&self, e: &Env) -> Result<i128, Error> {
        mul_div_floor(e, self.total_scaled_debt, self.borrow_index, SCALE)
    }

    /// Debt of a line or carried position: `ceil(scaled × index / SCALE)`.
    pub fn debt_of(&self, e: &Env, scaled: i128) -> Result<i128, Error> {
        mul_div_ceil(e, scaled, self.borrow_index, SCALE)
    }

    /// Scaled debt added by borrowing `amount`: rounded up (spec §5.2).
    pub fn scaled_for_borrow(&self, e: &Env, amount: i128) -> Result<i128, Error> {
        mul_div_ceil(e, amount, SCALE, self.borrow_index)
    }

    /// Scaled debt removed by a partial repayment of `amount`: rounded down,
    /// so a repayment never clears more debt than it pays.
    pub fn scaled_for_repayment(&self, e: &Env, amount: i128) -> Result<i128, Error> {
        mul_div_floor(e, amount, SCALE, self.borrow_index)
    }

    /// Books the rounding of a debt operation. Debts round up, so the book
    /// debt can move by a few stroops more than the cash that changed hands
    /// (`cash_in`: change in pool cash, negative for a draw). Crediting that
    /// surplus (always ≥ 0) to the junior tranche, the residual claimant,
    /// keeps the §5.3 invariant exact instead of letting dust accumulate.
    pub fn book_rounding(
        &mut self,
        e: &Env,
        debt_before: i128,
        cash_in: i128,
    ) -> Result<(), Error> {
        let debt_after = self.total_debt(e)?;
        let surplus = math::add(cash_in, math::sub(debt_after, debt_before)?)?;
        self.junior_assets = math::add(self.junior_assets, surplus)?;
        Ok(())
    }

    /// `max(0, pool_cash − fees_accrued)` (spec §5.4).
    pub fn lendable(&self, pool_cash: i128) -> i128 {
        pool_cash.saturating_sub(self.fees_accrued).max(0)
    }

    /// `max(0, max_leverage × junior_assets − total_debt)` (spec §5.4).
    pub fn leverage_headroom(&self, total_debt: i128) -> Result<i128, Error> {
        let cap = math::mul(i128::from(self.params.max_leverage), self.junior_assets)?;
        Ok(math::sub(cap, total_debt)?.max(0))
    }
}
