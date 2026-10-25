//! cpcv_note (spec §7.2). Placeholder; implemented by its workstream.
#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct CpcvNote;

#[contractimpl]
impl CpcvNote {
    pub fn version(_env: Env) -> u32 {
        0
    }
}
