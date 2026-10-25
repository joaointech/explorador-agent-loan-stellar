extern crate std;

use advance_shared::Error;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal, String,
};

use crate::{Teurc, TeurcClient, FAUCET_MAX};

const ONE: i128 = 10_000_000; // 1 tEURC

fn setup() -> (Env, Address, TeurcClient<'static>) {
    let e = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    let admin = Address::generate(&e);
    let id = e.register(Teurc, (&admin,));
    let client = TeurcClient::new(&e, &id);
    (e, admin, client)
}

#[test]
fn metadata() {
    let (e, _, t) = setup();
    assert_eq!(t.name(), String::from_str(&e, "Test Euro Coin"));
    assert_eq!(t.symbol(), String::from_str(&e, "tEURC"));
    assert_eq!(t.decimals(), 7);
}

#[test]
fn admin_mints() {
    let (e, admin, t) = setup();
    let to = Address::generate(&e);
    e.mock_all_auths();
    t.mint(&to, &(1_000_000 * ONE));
    // The admin, and only the admin, authorized the mint.
    let auths = e.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
    assert_eq!(t.balance(&to), 1_000_000 * ONE);
}

#[test]
fn non_admin_cannot_mint() {
    let (e, _, t) = setup();
    let intruder = Address::generate(&e);
    e.mock_auths(&[MockAuth {
        address: &intruder,
        invoke: &MockAuthInvoke {
            contract: &t.address,
            fn_name: "mint",
            args: (&intruder, 5 * ONE).into_val(&e),
            sub_invokes: &[],
        },
    }]);
    assert!(t.try_mint(&intruder, &(5 * ONE)).is_err());
    assert_eq!(t.balance(&intruder), 0);
}

#[test]
fn mint_rejects_non_positive_amounts() {
    let (e, _, t) = setup();
    let to = Address::generate(&e);
    e.mock_all_auths();
    assert_eq!(t.try_mint(&to, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(t.try_mint(&to, &-1), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn faucet_is_open_and_capped() {
    let (e, _, t) = setup();
    let investor = Address::generate(&e);
    // No auth needed at all.
    t.faucet(&investor, &(10_000 * ONE));
    assert_eq!(t.balance(&investor), 10_000 * ONE);
    assert!(e.auths().is_empty());

    t.faucet(&investor, &FAUCET_MAX);
    assert_eq!(t.balance(&investor), 35_000 * ONE);

    assert_eq!(
        t.try_faucet(&investor, &(FAUCET_MAX + 1)),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(t.try_faucet(&investor, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(t.balance(&investor), 35_000 * ONE);
}

#[test]
fn sep41_transfer_approve_burn() {
    let (e, _, t) = setup();
    e.mock_all_auths();
    let alice = Address::generate(&e);
    let bob = Address::generate(&e);
    let spender = Address::generate(&e);
    t.faucet(&alice, &(1_000 * ONE));

    t.transfer(&alice, &bob, &(300 * ONE));
    assert_eq!(t.balance(&alice), 700 * ONE);
    assert_eq!(t.balance(&bob), 300 * ONE);

    let live_until = e.ledger().sequence() + 1_000;
    t.approve(&alice, &spender, &(200 * ONE), &live_until);
    assert_eq!(t.allowance(&alice, &spender), 200 * ONE);
    t.transfer_from(&spender, &alice, &bob, &(150 * ONE));
    assert_eq!(t.allowance(&alice, &spender), 50 * ONE);
    assert_eq!(t.balance(&bob), 450 * ONE);

    t.burn(&bob, &(50 * ONE));
    assert_eq!(t.balance(&bob), 400 * ONE);
    t.burn_from(&spender, &alice, &(50 * ONE));
    assert_eq!(t.allowance(&alice, &spender), 0);
    assert_eq!(t.balance(&alice), 500 * ONE);

    // Overspending fails.
    assert!(t.try_transfer(&alice, &bob, &(501 * ONE)).is_err());
}

#[test]
fn ttls_are_extended_on_use() {
    use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
    let (e, _, t) = setup();
    let holder = Address::generate(&e);
    let other = Address::generate(&e);
    let day = 17_280;
    let instance_ttl = |e: &Env| e.as_contract(&t.address, || e.storage().instance().get_ttl());
    let balance_ttl = |e: &Env, a: &Address| {
        e.as_contract(&t.address, || {
            e.storage().persistent().get_ttl(
                &stellar_tokens::fungible::FungibleStorageKey::Balance(a.clone()),
            )
        })
    };

    t.faucet(&holder, &ONE);
    assert_eq!(instance_ttl(&e), 30 * day);
    assert_eq!(balance_ttl(&e, &holder), 90 * day);

    // 20 days later the instance is below half its ~30 days: any call extends
    // it; the balance (70 days left) is untouched.
    e.ledger().with_mut(|l| l.sequence_number += 20 * day);
    assert_eq!(t.decimals(), 7);
    assert_eq!(instance_ttl(&e), 30 * day);
    assert_eq!(balance_ttl(&e, &holder), 70 * day);

    // 48 days after the mint the balance is below half its ~90 days: a read
    // extends it (and the instance) again.
    e.ledger().with_mut(|l| l.sequence_number += 28 * day);
    assert_eq!(t.balance(&holder), ONE);
    assert_eq!(instance_ttl(&e), 30 * day);
    assert_eq!(balance_ttl(&e, &holder), 90 * day);

    // Transfers extend both balances.
    e.mock_all_auths();
    t.transfer(&holder, &other, &1);
    assert_eq!(balance_ttl(&e, &other), 90 * day);
}
