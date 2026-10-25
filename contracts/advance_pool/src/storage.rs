//! Storage layout (spec §7.3) and TTL policy (spec §7): instance ~30 days,
//! persistent records ~90 days, each extended when below half.
//!
//! Instance: roles, params, protocol clock and pool accounting.
//! Persistent: `Line(note_id)`, `Agent(address)`, `Draw(auth_ref)`, plus the
//! eaSR balances and supply kept by OpenZeppelin's fungible module.

use advance_shared::Error;
use soroban_sdk::{contracttype, Address, BytesN, Env, IntoVal, Val, Vec};
use stellar_tokens::fungible::FungibleStorageKey;

use crate::types::{AgentState, Line};

const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_THRESHOLD: u32 = INSTANCE_EXTEND_TO / 2;
pub const PERSISTENT_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
pub const PERSISTENT_THRESHOLD: u32 = PERSISTENT_EXTEND_TO / 2;

// Variant names must not collide with OpenZeppelin's keys (`Meta`, `Balance`,
// `Allowance`, `TotalSupply`), which live in the same contract storage.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ---- instance: roles and configuration
    Admin,
    Operator,
    Treasury,
    CardSettlement,
    Asset,
    NoteContract,
    Params,
    // ---- instance: protocol clock and accounting
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
    // ---- persistent
    Line(u32),
    Agent(Address),
    Draw(BytesN<32>),
}

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
}

pub fn get_instance<V: soroban_sdk::TryFromVal<Env, Val>>(e: &Env, key: &DataKey) -> V {
    // Every instance key is written by the constructor.
    e.storage().instance().get(key).unwrap()
}

pub fn set_instance<V: IntoVal<Env, Val>>(e: &Env, key: &DataKey, value: &V) {
    e.storage().instance().set(key, value);
}

fn bump_persistent<K: IntoVal<Env, Val>>(e: &Env, key: &K) {
    e.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_EXTEND_TO);
}

// ---------------------------------------------------------------- roles

pub fn admin(e: &Env) -> Address {
    get_instance(e, &DataKey::Admin)
}

pub fn operator(e: &Env) -> Address {
    get_instance(e, &DataKey::Operator)
}

pub fn treasury(e: &Env) -> Address {
    get_instance(e, &DataKey::Treasury)
}

pub fn card_settlement(e: &Env) -> Address {
    get_instance(e, &DataKey::CardSettlement)
}

pub fn asset(e: &Env) -> Address {
    get_instance(e, &DataKey::Asset)
}

pub fn note_contract(e: &Env) -> Address {
    get_instance(e, &DataKey::NoteContract)
}

// ---------------------------------------------------------------- lines

pub fn line(e: &Env, note_id: u32) -> Option<Line> {
    let key = DataKey::Line(note_id);
    let line = e.storage().persistent().get(&key);
    if line.is_some() {
        bump_persistent(e, &key);
    }
    line
}

pub fn line_or_err(e: &Env, note_id: u32) -> Result<Line, Error> {
    line(e, note_id).ok_or(Error::UnknownNote)
}

pub fn set_line(e: &Env, line: &Line) {
    let key = DataKey::Line(line.note_id);
    e.storage().persistent().set(&key, line);
    bump_persistent(e, &key);
}

// ---------------------------------------------------------------- agents

pub fn agent(e: &Env, agent: &Address) -> AgentState {
    let key = DataKey::Agent(agent.clone());
    match e.storage().persistent().get(&key) {
        Some(state) => {
            bump_persistent(e, &key);
            state
        }
        None => AgentState {
            card_balance: 0,
            card_enabled: false,
            blocked: false,
            active_lines: Vec::new(e),
            carried_principal: 0,
            carried_scaled: 0,
            grace_deadline: None,
            written_off_total: 0,
        },
    }
}

pub fn set_agent(e: &Env, agent: &Address, state: &AgentState) {
    let key = DataKey::Agent(agent.clone());
    e.storage().persistent().set(&key, state);
    bump_persistent(e, &key);
}

// ---------------------------------------------------------------- card draws

pub fn draw_recorded(e: &Env, auth_ref: &BytesN<32>) -> bool {
    let key = DataKey::Draw(auth_ref.clone());
    let recorded = e.storage().persistent().has(&key);
    if recorded {
        bump_persistent(e, &key);
    }
    recorded
}

pub fn record_draw(e: &Env, auth_ref: &BytesN<32>) {
    let key = DataKey::Draw(auth_ref.clone());
    e.storage().persistent().set(&key, &true);
    bump_persistent(e, &key);
}

// ---------------------------------------------------------------- eaSR balances

/// OpenZeppelin extends share balances on reads only; keep written ones alive.
pub fn bump_share_balance(e: &Env, account: &Address) {
    let key = FungibleStorageKey::Balance(account.clone());
    if e.storage().persistent().has(&key) {
        bump_persistent(e, &key);
    }
}
