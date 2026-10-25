//! teurc (spec §7.1). Placeholder; implemented by its workstream.
#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Teurc;

#[contractimpl]
impl Teurc {
    pub fn version(_env: Env) -> u32 {
        0
    }
}
