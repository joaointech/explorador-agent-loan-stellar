//! teurc: Test EURC (spec §7.1).
//!
//! A SEP-41 token built on the OpenZeppelin fungible `Base` contract type. It
//! stands in for Circle EURC on testnet: `advance_pool` takes the asset
//! address as a parameter, so real EURC can be swapped in later.
//!
//! - `mint` is admin only (seeding the treasury, demo resets).
//! - `faucet` is open to anyone, capped at 25,000 tEURC per call.
//!
//! The SEP-41 methods wrap the OpenZeppelin defaults only to extend TTLs on
//! every call (instance ~30 days, balances ~90 days), which the library
//! leaves to the implementor.
#![no_std]

use advance_shared::Error;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, MuxedAddress, String};
use stellar_tokens::fungible::{
    burnable::FungibleBurnable, Base, FungibleStorageKey, FungibleToken,
};

/// tEURC has 7 decimals, like Circle EURC on Stellar.
pub const DECIMALS: u32 = 7;
/// Largest `faucet` amount per call: 25,000 tEURC in stroops.
pub const FAUCET_MAX: i128 = 25_000 * 10_000_000;

const DAY_IN_LEDGERS: u32 = 17_280;
/// Instance TTL is extended to ~30 days whenever it drops below ~15 days.
const INSTANCE_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_EXTEND_TO / 2;
/// Balances are extended to ~90 days whenever they drop below ~45 days.
const BALANCE_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
const BALANCE_THRESHOLD: u32 = BALANCE_EXTEND_TO / 2;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
}

#[contract]
pub struct Teurc;

#[contractimpl]
impl Teurc {
    pub fn __constructor(e: &Env, admin: Address) {
        Base::set_metadata(
            e,
            DECIMALS,
            String::from_str(e, "Test Euro Coin"),
            String::from_str(e, "tEURC"),
        );
        e.storage().instance().set(&DataKey::Admin, &admin);
        bump_instance(e);
    }

    /// Mints `amount` to `to`. Admin only.
    pub fn mint(e: &Env, to: Address, amount: i128) -> Result<(), Error> {
        bump_instance(e);
        let admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        admin.require_auth();
        issue(e, &to, amount)
    }

    /// Testnet faucet: anyone can mint up to 25,000 tEURC per call to any
    /// address.
    pub fn faucet(e: &Env, to: Address, amount: i128) -> Result<(), Error> {
        bump_instance(e);
        if amount > FAUCET_MAX {
            return Err(Error::InvalidAmount);
        }
        issue(e, &to, amount)
    }
}

fn issue(e: &Env, to: &Address, amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    <Teurc as FungibleToken>::ContractType::mint(e, to, amount);
    bump_balance(e, to);
    Ok(())
}

fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
}

fn bump_balance(e: &Env, account: &Address) {
    let key = FungibleStorageKey::Balance(account.clone());
    if e.storage().persistent().has(&key) {
        e.storage()
            .persistent()
            .extend_ttl(&key, BALANCE_THRESHOLD, BALANCE_EXTEND_TO);
    }
}

// SEP-41: balance, allowance, transfer, transfer_from, approve, decimals, name,
// symbol. Behaviour is the OpenZeppelin `Base` one.
#[contractimpl(contracttrait)]
impl FungibleToken for Teurc {
    type ContractType = Base;

    fn balance(e: &Env, account: Address) -> i128 {
        bump_instance(e);
        let balance = Self::ContractType::balance(e, &account);
        bump_balance(e, &account);
        balance
    }

    fn allowance(e: &Env, owner: Address, spender: Address) -> i128 {
        bump_instance(e);
        Self::ContractType::allowance(e, &owner, &spender)
    }

    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        bump_instance(e);
        Self::ContractType::transfer(e, &from, &to, amount);
        bump_balance(e, &from);
        bump_balance(e, &to.address());
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        bump_instance(e);
        Self::ContractType::transfer_from(e, &spender, &from, &to, amount);
        bump_balance(e, &from);
        bump_balance(e, &to);
    }

    fn approve(e: &Env, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        bump_instance(e);
        Self::ContractType::approve(e, &owner, &spender, amount, live_until_ledger);
    }

    fn decimals(e: &Env) -> u32 {
        bump_instance(e);
        Self::ContractType::decimals(e)
    }

    fn name(e: &Env) -> String {
        bump_instance(e);
        Self::ContractType::name(e)
    }

    fn symbol(e: &Env) -> String {
        bump_instance(e);
        Self::ContractType::symbol(e)
    }
}

// SEP-41: burn, burn_from.
#[contractimpl(contracttrait)]
impl FungibleBurnable for Teurc {
    fn burn(e: &Env, from: Address, amount: i128) {
        bump_instance(e);
        Self::ContractType::burn(e, &from, amount);
        bump_balance(e, &from);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        bump_instance(e);
        Self::ContractType::burn_from(e, &spender, &from, amount);
        bump_balance(e, &from);
    }
}

#[cfg(test)]
mod test;
