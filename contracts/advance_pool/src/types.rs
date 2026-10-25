//! Contract types of `advance_pool` (spec §7.3). Amounts are tEURC stroops.

use soroban_sdk::{contracttype, Address, Vec};

/// Protocol parameters, fixed at deploy (spec §5.1).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Params {
    /// Agent APR on drawn balances (1200 = 12%).
    pub agent_apr_bps: u32,
    /// Share of interest that goes to explorador (1000 = 10%).
    pub protocol_fee_bps: u32,
    /// Senior tranche APY target (800 = 8%).
    pub senior_target_bps: u32,
    /// Credit limit as a share of the agent commission (5000 = 50%).
    pub ltv_bps: u32,
    /// Grace period before carried debt can be written off.
    pub grace_period_secs: u64,
    /// Total debt ≤ max_leverage × junior assets.
    pub max_leverage: u32,
    /// Enables `advance_clock` (spec §5.7).
    pub demo_mode: bool,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LineStatus {
    Active,
    Settled,
    Cancelled,
}

/// Credit line backed by one CPCV Note.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Line {
    pub note_id: u32,
    pub agent: Address,
    /// agent_commission × ltv_bps / BPS (rounded down).
    pub credit_limit: i128,
    /// Amount drawn and not yet repaid.
    pub principal: i128,
    /// Debt in borrow-index units: debt = ceil(scaled_debt × borrow_index / SCALE).
    pub scaled_debt: i128,
    /// Days since the Unix epoch; earliest escritura is drawn first.
    pub escritura_day: u32,
    pub status: LineStatus,
}

/// Per-agent state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentState {
    /// tEURC owned by the agent, held by the pool, spendable by card.
    pub card_balance: i128,
    /// Agent's on-chain consent for the operator to draw on their behalf.
    pub card_enabled: bool,
    pub blocked: bool,
    /// Active line ids, ordered by (escritura_day, note_id).
    pub active_lines: Vec<u32>,
    /// Debt moved from cancelled notes (or settlement shortfalls).
    pub carried_principal: i128,
    pub carried_scaled: i128,
    /// Protocol-clock deadline after which carried debt can be written off.
    pub grace_deadline: Option<u64>,
    pub written_off_total: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LineView {
    pub line: Line,
    /// Current debt (rounded up).
    pub debt: i128,
    /// debt − principal.
    pub interest: i128,
    /// max(0, credit_limit − debt) for active lines, 0 otherwise.
    pub available: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentPosition {
    pub card_balance: i128,
    pub card_enabled: bool,
    pub blocked: bool,
    /// Active lines in draw order.
    pub lines: Vec<LineView>,
    pub carried_debt: i128,
    pub grace_deadline: Option<u64>,
    /// Debt on active lines + carried debt.
    pub total_debt: i128,
    pub total_principal: i128,
    /// blocked ? 0 : max(0, Σ line available − carried debt).
    pub available_credit: i128,
    /// min(available_credit, lendable, leverage_headroom).
    pub borrowable_now: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolStats {
    pub senior_assets: i128,
    pub junior_assets: i128,
    pub fees_accrued: i128,
    pub total_debt: i128,
    pub total_principal: i128,
    /// asset.balance(pool) − total_card_balances.
    pub pool_cash: i128,
    pub total_card_balances: i128,
    pub share_supply: i128,
    /// Assets per 1 share × SCALE: (senior_assets + 1) × SCALE / (supply + 1).
    pub share_price_scaled: i128,
    /// total_debt / (total_debt + lendable), in bps.
    pub utilization_bps: u32,
    /// total_debt / junior_assets × 100.
    pub leverage_x100: u32,
    pub lendable: i128,
    pub leverage_headroom: i128,
    pub borrow_index: i128,
    pub protocol_now: u64,
    pub params: Params,
    pub written_off_total: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrawResult {
    pub from_balance: i128,
    pub from_credit: i128,
}
