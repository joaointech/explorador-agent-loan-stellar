//! Cross-contract interfaces. Using client traits (instead of importing the
//! other contract's wasm) avoids a circular build dependency between
//! `cpcv_note` and `advance_pool`.

use soroban_sdk::{contractclient, Env};

use crate::types::{Note, NoteStatus};

/// What `cpcv_note` calls on `advance_pool`.
#[contractclient(name = "PoolClient")]
pub trait PoolInterface {
    /// Opens the credit line for a freshly minted note (note contract only).
    /// Takes the note by value: Soroban forbids contract re-entry, so the
    /// pool cannot call back into `cpcv_note.get` while `mint` is running.
    fn open_line(env: Env, note: Note);
    /// Single source of truth for time: ledger timestamp + demo offset (spec §5.7).
    fn protocol_now(env: Env) -> u64;
}

/// What `advance_pool` calls on `cpcv_note`.
#[contractclient(name = "NoteClient")]
pub trait NoteInterface {
    fn get(env: Env, id: u32) -> Note;
    /// Pool only.
    fn set_status(env: Env, id: u32, status: NoteStatus);
}
