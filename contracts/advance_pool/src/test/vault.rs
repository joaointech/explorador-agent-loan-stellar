//! Senior vault: SEP-56 over the eaSR SEP-41 share token (spec §5.5).

use advance_shared::{math::SCALE, Error};
use soroban_sdk::{testutils::Events as _, Event as _, String};
use stellar_tokens::vault::{Deposit, Withdraw};

use super::*;

fn down(x: i128, num: i128, den: i128) -> i128 {
    x * num / den
}

fn up(x: i128, num: i128, den: i128) -> i128 {
    (x * num + den - 1) / den
}

/// A vault whose share price is above 1: interest on a €3,000 draw for a
/// year flows to the senior tranche (8% target on €1,000).
fn appreciated_vault() -> (Ctx, Address) {
    let ctx = Ctx::new(default_params(), 0);
    let first = ctx.investor(1_000 * EUR);
    assert_eq!(ctx.pool.balance(&first), 1_000 * EUR);
    let agent = ctx.agent();
    ctx.note(&agent, 15_000 * EUR, 400);
    ctx.draw(&agent, 3_000 * EUR);
    ctx.advance_days(365);
    ctx.pool.accrue();
    let stats = ctx.stats();
    assert!(stats.senior_assets > 1_000 * EUR);
    assert!(stats.share_price_scaled > SCALE);
    (ctx, first)
}

#[test]
fn first_deposit_mints_one_share_per_stroop() {
    let ctx = Ctx::new(default_params(), 0);
    let investor = Address::generate(&ctx.e);
    ctx.fund(&investor, 1_000 * EUR);
    assert_eq!(ctx.pool.preview_deposit(&(1_000 * EUR)), 1_000 * EUR);
    let shares = ctx
        .pool
        .deposit(&(1_000 * EUR), &investor, &investor, &investor);
    assert_eq!(shares, 1_000 * EUR);
    // SEP-56 deposit event (OpenZeppelin layout).
    let events = ctx.e.events().all().filter_by_contract(&ctx.pool.address);
    assert_eq!(
        events.events().last().unwrap(),
        &Deposit {
            operator: investor.clone(),
            from: investor.clone(),
            receiver: investor.clone(),
            assets: 1_000 * EUR,
            shares,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    assert_eq!(ctx.pool.balance(&investor), shares);
    assert_eq!(ctx.pool.total_supply(), shares);
    assert_eq!(ctx.pool.total_assets(), 1_000 * EUR);
    assert_eq!(ctx.token.balance(&investor), 0);
    assert_eq!(ctx.stats().share_price_scaled, SCALE);
    ctx.assert_invariant();
}

#[test]
fn deposit_withdraw_redeem_math() {
    let (ctx, first) = appreciated_vault();
    let assets = ctx.pool.total_assets();
    let supply = ctx.pool.total_supply();
    let (t, n) = (assets + 1, supply + 1);

    // Conversions: assets × (N + 1) / (T + 1) and back, rounded down.
    assert_eq!(
        ctx.pool.convert_to_shares(&(540 * EUR)),
        down(540 * EUR, n, t)
    );
    assert_eq!(
        ctx.pool.convert_to_assets(&(500 * EUR)),
        down(500 * EUR, t, n)
    );
    assert_eq!(
        ctx.pool.preview_deposit(&(540 * EUR)),
        down(540 * EUR, n, t)
    );
    assert_eq!(ctx.pool.preview_redeem(&(500 * EUR)), down(500 * EUR, t, n));
    // Paying in rounds up for the pool: mint charges, withdraw burns.
    assert_eq!(ctx.pool.preview_mint(&(500 * EUR)), up(500 * EUR, t, n));
    assert_eq!(ctx.pool.preview_withdraw(&(540 * EUR)), up(540 * EUR, n, t));

    // A second investor deposits at the higher price: fewer shares.
    let second = Address::generate(&ctx.e);
    ctx.fund(&second, 2_000 * EUR);
    let shares = ctx.pool.deposit(&(540 * EUR), &second, &second, &second);
    assert_eq!(shares, down(540 * EUR, n, t));
    assert!(shares < 540 * EUR);
    let (t, n) = (t + 540 * EUR, n + shares);

    // mint: exact shares for rounded-up assets.
    let charged = ctx.pool.mint(&(100 * EUR), &second, &second, &second);
    assert_eq!(charged, up(100 * EUR, t, n));
    let (t, n) = (t + charged, n + 100 * EUR);
    assert_eq!(ctx.pool.balance(&second), shares + 100 * EUR);
    assert_eq!(
        ctx.token.balance(&second),
        2_000 * EUR - 540 * EUR - charged
    );

    // withdraw: exact assets, rounded-up shares burned.
    let burned = ctx.pool.withdraw(&(300 * EUR), &second, &second, &second);
    assert_eq!(burned, up(300 * EUR, n, t));
    let events = ctx.e.events().all().filter_by_contract(&ctx.pool.address);
    assert_eq!(
        events.events().last().unwrap(),
        &Withdraw {
            operator: second.clone(),
            receiver: second.clone(),
            owner: second.clone(),
            assets: 300 * EUR,
            shares: burned,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    let (t, n) = (t - 300 * EUR, n - burned);

    // redeem: exact shares, rounded-down assets.
    let paid = ctx.pool.redeem(&(50 * EUR), &second, &second, &second);
    assert_eq!(paid, down(50 * EUR, t, n));
    let (t, n) = (t - paid, n - 50 * EUR);

    assert_eq!(ctx.pool.total_assets(), t - 1);
    assert_eq!(ctx.pool.total_supply(), n - 1);
    assert_eq!(
        ctx.pool.total_supply(),
        ctx.pool.balance(&first) + ctx.pool.balance(&second)
    );
    // The first investor's position grew with the interest.
    let value = ctx.pool.convert_to_assets(&ctx.pool.balance(&first));
    assert!(value > 1_000 * EUR);
    assert_eq!(ctx.pool.max_withdraw(&first), value);
    ctx.pool
        .redeem(&ctx.pool.max_redeem(&first), &first, &first, &first);
    assert_eq!(ctx.token.balance(&first), value);
    ctx.assert_invariant();
}

#[test]
fn rounding_never_pays_out_dust() {
    let (ctx, first) = appreciated_vault();
    // At a price above 1, one stroop buys no share: the deposit is refused.
    assert_eq!(ctx.pool.preview_deposit(&1), 0);
    let dust = Address::generate(&ctx.e);
    ctx.fund(&dust, 1);
    assert_eq!(
        ctx.pool.try_deposit(&1, &dust, &dust, &dust),
        Err(Ok(Error::InvalidAmount))
    );
    // Withdrawing one stroop still burns a whole share.
    assert_eq!(ctx.pool.preview_withdraw(&1), 1);
    let before = ctx.pool.balance(&first);
    ctx.pool.withdraw(&1, &first, &first, &first);
    assert_eq!(ctx.pool.balance(&first), before - 1);
    // Round trips never gain.
    let shares = ctx.pool.preview_deposit(&(777 * EUR));
    assert!(ctx.pool.preview_redeem(&shares) <= 777 * EUR);
    assert!(ctx.pool.preview_mint(&shares) <= 777 * EUR + 1);
    ctx.assert_invariant();
}

#[test]
fn withdrawals_are_capped_by_lendable_cash() {
    let ctx = Ctx::new(default_params(), 0);
    let investor = ctx.investor(1_000 * EUR);
    let agent = ctx.agent();
    ctx.note(&agent, 100_000 * EUR, 90);
    ctx.draw(&agent, 10_500 * EUR); // cash left: €11,000 − €10,500
    assert_eq!(ctx.stats().lendable, 500 * EUR);

    assert_eq!(ctx.pool.max_withdraw(&investor), 500 * EUR);
    assert_eq!(ctx.pool.max_redeem(&investor), 500 * EUR);
    assert_eq!(
        ctx.pool
            .try_withdraw(&(500 * EUR + 1), &investor, &investor, &investor),
        Err(Ok(Error::InsufficientLiquidity))
    );
    assert_eq!(
        ctx.pool
            .try_redeem(&(501 * EUR), &investor, &investor, &investor),
        Err(Ok(Error::InsufficientLiquidity))
    );
    ctx.pool
        .withdraw(&(500 * EUR), &investor, &investor, &investor);
    assert_eq!(ctx.pool.max_withdraw(&investor), 0);
    assert_eq!(ctx.pool.max_redeem(&investor), 0);
    assert_eq!(
        ctx.pool.convert_to_assets(&ctx.pool.balance(&investor)),
        500 * EUR
    );
    ctx.assert_invariant();
}

#[test]
fn vault_rejects_bad_amounts() {
    let ctx = Ctx::new(default_params(), 0);
    let investor = ctx.investor(1_000 * EUR);
    let other = Address::generate(&ctx.e);
    assert_eq!(
        ctx.pool.try_deposit(&0, &investor, &investor, &investor),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        ctx.pool
            .try_withdraw(&(1_000 * EUR + 1), &investor, &investor, &investor),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        ctx.pool
            .try_redeem(&(1_000 * EUR + 1), &investor, &investor, &investor),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        ctx.pool.try_redeem(&EUR, &other, &other, &other),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        ctx.pool.try_convert_to_shares(&-1),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        ctx.pool.try_mint(&0, &investor, &investor, &investor),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(ctx.pool.query_asset(), ctx.token.address);
    assert_eq!(ctx.pool.max_deposit(&investor), i128::MAX);
    assert_eq!(ctx.pool.max_mint(&investor), i128::MAX);
}

#[test]
fn operators_use_allowances() {
    let ctx = Ctx::new(default_params(), 0);
    let owner = Address::generate(&ctx.e);
    let operator = Address::generate(&ctx.e);
    let receiver = Address::generate(&ctx.e);
    ctx.fund(&owner, 1_000 * EUR);
    let live_until = ctx.e.ledger().sequence() + 10_000;

    // Deposit on behalf of `owner`: the operator spends owner's tEURC allowance.
    assert!(ctx
        .pool
        .try_deposit(&(400 * EUR), &owner, &owner, &operator)
        .is_err());
    ctx.token
        .approve(&owner, &operator, &(400 * EUR), &live_until);
    let shares = ctx.pool.deposit(&(400 * EUR), &owner, &owner, &operator);
    assert_eq!(ctx.e.auths()[0].0, operator);
    assert_eq!(ctx.pool.balance(&owner), shares);
    assert_eq!(ctx.token.allowance(&owner, &operator), 0);
    assert_eq!(ctx.token.balance(&owner), 600 * EUR);

    // Withdraw on behalf of `owner`: the operator spends owner's eaSR allowance.
    assert!(ctx
        .pool
        .try_withdraw(&(100 * EUR), &receiver, &owner, &operator)
        .is_err());
    ctx.pool
        .approve(&owner, &operator, &(150 * EUR), &live_until);
    let burned = ctx
        .pool
        .withdraw(&(100 * EUR), &receiver, &owner, &operator);
    assert_eq!(ctx.token.balance(&receiver), 100 * EUR);
    assert_eq!(ctx.pool.allowance(&owner, &operator), 150 * EUR - burned);
    assert_eq!(ctx.pool.balance(&owner), shares - burned);
    ctx.assert_invariant();
}

#[test]
fn donations_do_not_move_the_share_price() {
    let ctx = Ctx::new(default_params(), 0);
    let investor = ctx.investor(1_000 * EUR);
    let before = ctx.stats();
    let price = ctx.pool.preview_deposit(&(100 * EUR));

    // Anyone can send tEURC straight to the pool...
    let donor = Address::generate(&ctx.e);
    ctx.fund(&donor, 5_000 * EUR);
    ctx.token
        .transfer(&donor, &ctx.pool.address, &(5_000 * EUR));

    // ...but the vault is accounting-based.
    let after = ctx.stats();
    assert_eq!(ctx.pool.total_assets(), 1_000 * EUR);
    assert_eq!(after.share_price_scaled, before.share_price_scaled);
    assert_eq!(ctx.pool.preview_deposit(&(100 * EUR)), price);
    assert_eq!(
        ctx.pool.convert_to_assets(&ctx.pool.balance(&investor)),
        1_000 * EUR
    );
    // It only adds lendable liquidity.
    assert_eq!(after.lendable, before.lendable + 5_000 * EUR);
    let s = after;
    assert_eq!(
        s.senior_assets + s.junior_assets + s.fees_accrued + 5_000 * EUR,
        s.pool_cash + s.total_debt
    );
}

#[test]
fn easr_is_a_sep41_token() {
    let (ctx, first) = appreciated_vault();
    assert_eq!(
        ctx.pool.name(),
        String::from_str(&ctx.e, "explorador advance Senior")
    );
    assert_eq!(ctx.pool.symbol(), String::from_str(&ctx.e, "eaSR"));
    assert_eq!(ctx.pool.decimals(), 7);

    let friend = Address::generate(&ctx.e);
    ctx.pool.transfer(&first, &friend, &(100 * EUR));
    assert_eq!(ctx.pool.balance(&friend), 100 * EUR);
    assert_eq!(
        ctx.pool.max_withdraw(&friend),
        ctx.pool.convert_to_assets(&(100 * EUR))
    );
    assert_eq!(
        ctx.pool.total_supply(),
        ctx.pool.balance(&first) + 100 * EUR
    );

    // Burning shares leaves their value to the other holders.
    let price = ctx.stats().share_price_scaled;
    ctx.pool.burn(&friend, &(100 * EUR));
    assert_eq!(ctx.pool.total_supply(), ctx.pool.balance(&first));
    assert!(ctx.stats().share_price_scaled > price);
    let live_until = ctx.e.ledger().sequence() + 1_000;
    ctx.pool.approve(&first, &friend, &(10 * EUR), &live_until);
    ctx.pool.burn_from(&friend, &first, &(10 * EUR));
    assert_eq!(ctx.pool.total_supply(), ctx.pool.balance(&first));
    ctx.assert_invariant();
}
