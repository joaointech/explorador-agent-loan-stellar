//! Storage layout (§7.3) and the in-memory accounting book.

use crate::types::{AgentState, Line, Params};
use advance_shared::{math::SCALE, ttl, Error};
use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // instance
    Admin,
    Operator,
    Treasury,
    CardSettlement,
    Asset,
    NoteContract,
    Params,
    DemoOffset,
    LastAccrual,
    BorrowIndex,
    TotalScaledDebt,
    TotalPrincipal,
    SeniorAssets,
    JuniorAssets,
    FeesAccrued,
    TotalCardBalances,
    WrittenOffTotal,
    ShareSupply,
    // persistent
    Line(u32),
    Agent(Address),
    Draw(BytesN<32>),
}

pub fn get_addr(e: &Env, key: &DataKey) -> Address {
    e.storage()
        .instance()
        .get(key)
        .unwrap_or_else(|| panic_with_error!(e, Error::NotAuthorized))
}

pub fn params(e: &Env) -> Params {
    e.storage().instance().get(&DataKey::Params).unwrap()
}

/// All mutable pool-wide accounting, loaded from / saved to instance storage.
#[derive(Clone, Debug)]
pub struct Book {
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
    pub share_supply: i128,
}

fn get_i128(e: &Env, key: &DataKey) -> i128 {
    e.storage().instance().get(key).unwrap_or(0)
}

impl Book {
    pub fn load(e: &Env) -> Book {
        let s = e.storage().instance();
        Book {
            demo_offset: s.get(&DataKey::DemoOffset).unwrap_or(0),
            last_accrual: s.get(&DataKey::LastAccrual).unwrap_or(0),
            borrow_index: s.get(&DataKey::BorrowIndex).unwrap_or(SCALE),
            total_scaled_debt: get_i128(e, &DataKey::TotalScaledDebt),
            total_principal: get_i128(e, &DataKey::TotalPrincipal),
            senior_assets: get_i128(e, &DataKey::SeniorAssets),
            junior_assets: get_i128(e, &DataKey::JuniorAssets),
            fees_accrued: get_i128(e, &DataKey::FeesAccrued),
            total_card_balances: get_i128(e, &DataKey::TotalCardBalances),
            written_off_total: get_i128(e, &DataKey::WrittenOffTotal),
            share_supply: get_i128(e, &DataKey::ShareSupply),
        }
    }

    pub fn save(&self, e: &Env) {
        let s = e.storage().instance();
        s.set(&DataKey::DemoOffset, &self.demo_offset);
        s.set(&DataKey::LastAccrual, &self.last_accrual);
        s.set(&DataKey::BorrowIndex, &self.borrow_index);
        s.set(&DataKey::TotalScaledDebt, &self.total_scaled_debt);
        s.set(&DataKey::TotalPrincipal, &self.total_principal);
        s.set(&DataKey::SeniorAssets, &self.senior_assets);
        s.set(&DataKey::JuniorAssets, &self.junior_assets);
        s.set(&DataKey::FeesAccrued, &self.fees_accrued);
        s.set(&DataKey::TotalCardBalances, &self.total_card_balances);
        s.set(&DataKey::WrittenOffTotal, &self.written_off_total);
        s.set(&DataKey::ShareSupply, &self.share_supply);
        ttl::bump_instance(e);
    }
}

pub fn read_line(e: &Env, note_id: u32) -> Option<Line> {
    let key = DataKey::Line(note_id);
    let line: Option<Line> = e.storage().persistent().get(&key);
    if line.is_some() {
        ttl::bump_persistent(e, &key);
    }
    line
}

pub fn write_line(e: &Env, line: &Line) {
    let key = DataKey::Line(line.note_id);
    e.storage().persistent().set(&key, line);
    ttl::bump_persistent(e, &key);
}

pub fn default_agent(e: &Env) -> AgentState {
    AgentState {
        card_balance: 0,
        card_enabled: false,
        blocked: false,
        active_lines: Vec::new(e),
        carried_principal: 0,
        carried_scaled: 0,
        grace_deadline: None,
        written_off_total: 0,
    }
}

pub fn read_agent(e: &Env, agent: &Address) -> AgentState {
    let key = DataKey::Agent(agent.clone());
    match e.storage().persistent().get::<_, AgentState>(&key) {
        Some(a) => {
            ttl::bump_persistent(e, &key);
            a
        }
        None => default_agent(e),
    }
}

pub fn write_agent(e: &Env, agent: &Address, state: &AgentState) {
    let key = DataKey::Agent(agent.clone());
    e.storage().persistent().set(&key, state);
    ttl::bump_persistent(e, &key);
}

pub fn draw_used(e: &Env, auth_ref: &BytesN<32>) -> bool {
    let key = DataKey::Draw(auth_ref.clone());
    let used = e.storage().persistent().has(&key);
    if used {
        ttl::bump_persistent(e, &key);
    }
    used
}

pub fn mark_draw(e: &Env, auth_ref: &BytesN<32>) {
    let key = DataKey::Draw(auth_ref.clone());
    e.storage().persistent().set(&key, &true);
    ttl::bump_persistent(e, &key);
}
