use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Params {
    pub agent_apr_bps: u32,
    pub protocol_fee_bps: u32,
    pub senior_target_bps: u32,
    pub ltv_bps: u32,
    pub grace_period_secs: u64,
    pub max_leverage: u32,
    pub demo_mode: bool,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LineStatus {
    Active,
    Settled,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Line {
    pub note_id: u32,
    pub agent: Address,
    pub credit_limit: i128,
    pub principal: i128,
    pub scaled_debt: i128,
    pub escritura_day: u32,
    pub status: LineStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentState {
    pub card_balance: i128,
    pub card_enabled: bool,
    pub blocked: bool,
    pub active_lines: Vec<u32>,
    pub carried_principal: i128,
    pub carried_scaled: i128,
    pub grace_deadline: Option<u64>,
    pub written_off_total: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LineView {
    pub line: Line,
    pub debt: i128,
    pub interest: i128,
    pub available: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentPosition {
    pub card_balance: i128,
    pub card_enabled: bool,
    pub blocked: bool,
    pub lines: Vec<LineView>,
    pub carried_debt: i128,
    pub grace_deadline: Option<u64>,
    pub total_debt: i128,
    pub total_principal: i128,
    pub available_credit: i128,
    pub borrowable_now: i128,
}

/// Pool-wide numbers, computed against a non-mutating preview of `accrue()`.
///
/// - `share_price_scaled` = (total_assets + 1) × SCALE / (supply + 1): assets per share × 10^18.
/// - `utilization_bps` = total_debt × BPS / (senior_assets + junior_assets), 0 when the denominator is 0.
/// - `leverage_x100` = total_debt × 100 / junior_assets (0 with no debt, u32::MAX-capped).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolStats {
    pub senior_assets: i128,
    pub junior_assets: i128,
    pub fees_accrued: i128,
    pub total_debt: i128,
    pub total_principal: i128,
    pub pool_cash: i128,
    pub total_card_balances: i128,
    pub share_supply: i128,
    pub share_price_scaled: i128,
    pub utilization_bps: u32,
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

/// Static wiring of the pool (helper view for the backend).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolConfig {
    pub admin: Address,
    pub operator: Address,
    pub treasury: Address,
    pub card_settlement: Address,
    pub asset: Address,
    pub note_contract: Address,
}
