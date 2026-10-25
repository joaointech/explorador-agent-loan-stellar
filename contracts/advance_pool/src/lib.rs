//! advance_pool (spec §7.3). Placeholder; implemented by its workstream.
#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct AdvancePool;

#[contractimpl]
impl AdvancePool {
    pub fn version(_env: Env) -> u32 {
        0
    }
}
