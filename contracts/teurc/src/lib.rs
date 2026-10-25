#![no_std]
//! `teurc` — Test Euro Coin, a SEP-41 token that stands in for Circle EURC on
//! testnet (spec §7.1). 7 decimals. Anyone can use the capped faucet.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, MuxedAddress, String};
use stellar_tokens::fungible::{burnable::FungibleBurnable, Base, FungibleToken};

/// 25,000 tEURC per faucet call.
pub const FAUCET_MAX: i128 = 25_000 * 10_000_000;

const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_EXTEND_TO / 2;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TeurcError {
    InvalidAmount = 3,
    FaucetLimitExceeded = 23,
}

#[contracttype]
enum DataKey {
    Admin,
}

#[contract]
pub struct Teurc;

#[contractimpl]
impl Teurc {
    pub fn __constructor(e: Env, admin: Address) {
        e.storage().instance().set(&DataKey::Admin, &admin);
        Base::set_metadata(&e, 7, String::from_str(&e, "Test Euro Coin"), String::from_str(&e, "tEURC"));
        e.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    /// Admin only.
    pub fn mint(e: Env, to: Address, amount: i128) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, TeurcError::InvalidAmount);
        }
        Base::mint(&e, &to, amount);
        e.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    /// Anyone (testnet only): up to 25,000 tEURC per call.
    pub fn faucet(e: Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(&e, TeurcError::InvalidAmount);
        }
        if amount > FAUCET_MAX {
            panic_with_error!(&e, TeurcError::FaucetLimitExceeded);
        }
        Base::mint(&e, &to, amount);
        e.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    pub fn admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for Teurc {
    type ContractType = Base;
}

#[contractimpl(contracttrait)]
impl FungibleBurnable for Teurc {}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn metadata_mint_faucet_transfer_burn() {
        let e = Env::default();
        e.mock_all_auths();
        let admin = Address::generate(&e);
        let id = e.register(Teurc, (admin.clone(),));
        let t = TeurcClient::new(&e, &id);
        assert_eq!(t.decimals(), 7);
        assert_eq!(t.symbol(), String::from_str(&e, "tEURC"));
        assert_eq!(t.name(), String::from_str(&e, "Test Euro Coin"));

        let a = Address::generate(&e);
        let b = Address::generate(&e);
        t.mint(&a, &1_000_0000000);
        t.faucet(&b, &FAUCET_MAX);
        assert!(t.try_faucet(&b, &(FAUCET_MAX + 1)).is_err());
        t.transfer(&a, &b, &250_0000000);
        assert_eq!(t.balance(&a), 750_0000000);
        assert_eq!(t.balance(&b), FAUCET_MAX + 250_0000000);
        t.approve(&a, &b, &100_0000000, &1000);
        t.transfer_from(&b, &a, &b, &100_0000000);
        assert_eq!(t.allowance(&a, &b), 0);
        t.burn(&a, &50_0000000);
        assert_eq!(t.balance(&a), 600_0000000);
    }

    #[test]
    #[should_panic]
    fn mint_requires_admin() {
        let e = Env::default();
        let admin = Address::generate(&e);
        let id = e.register(Teurc, (admin,));
        TeurcClient::new(&e, &id).mint(&Address::generate(&e), &1);
    }
}
