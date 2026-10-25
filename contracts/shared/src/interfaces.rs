//! Cross-contract interfaces between `cpcv_note` and `advance_pool`.

use crate::types::{Note, NoteStatus};
use soroban_sdk::{contractclient, Address, Env};

/// The subset of `advance_pool` that `cpcv_note` calls.
#[allow(dead_code)]
#[contractclient(name = "PoolClient")]
pub trait PoolInterface {
    fn protocol_now(e: Env) -> u64;
    /// Soroban forbids re-entrancy (note → pool → note), so the note contract
    /// passes the note's terms instead of the pool reading them back.
    fn open_line(e: Env, note_id: u32, agent: Address, agent_commission: i128, escritura_day: u32);
}

/// The subset of `cpcv_note` that `advance_pool` calls.
#[allow(dead_code)]
#[contractclient(name = "NoteClient")]
pub trait NoteInterface {
    fn get(e: Env, id: u32) -> Note;
    fn set_status(e: Env, id: u32, status: NoteStatus);
}
