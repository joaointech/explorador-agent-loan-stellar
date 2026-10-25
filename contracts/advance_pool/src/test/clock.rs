//! Protocol clock and demo fast-forward (spec §5.7), TTLs (spec §7).

use advance_shared::{
    math::{BPS, SCALE, YEAR},
    Error,
};
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Events as _,
    },
    Event as _,
};

use super::*;
use crate::{storage::DataKey, ClockAdvanced, MAX_CLOCK_ADVANCE_SECS};

fn stored<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(ctx: &Ctx, key: DataKey) -> V {
    ctx.e.as_contract(&ctx.pool.address, || {
        ctx.e.storage().instance().get(&key).unwrap()
    })
}

#[test]
fn protocol_now_is_ledger_time_plus_offset() {
    let ctx = Ctx::new(default_params(), 0);
    assert_eq!(ctx.pool.protocol_now(), START);
    ctx.e.ledger().set_timestamp(START + 3_600);
    assert_eq!(ctx.pool.protocol_now(), START + 3_600);
    ctx.advance_days(30);
    assert_eq!(ctx.pool.protocol_now(), START + 3_600 + 30 * DAY);
    assert_eq!(ctx.stats().protocol_now, START + 3_600 + 30 * DAY);
}

#[test]
fn advance_clock_only_in_demo_mode() {
    let ctx = Ctx::new(
        Params {
            demo_mode: false,
            ..default_params()
        },
        0,
    );
    assert_eq!(
        ctx.pool.try_advance_clock(&DAY),
        Err(Ok(Error::DemoModeDisabled))
    );
    assert_eq!(ctx.pool.protocol_now(), START);
    assert!(!ctx.pool.params().demo_mode);
}

#[test]
fn advance_clock_is_admin_only() {
    let ctx = Ctx::new(default_params(), 0);
    ctx.advance_days(1);
    let auths = ctx.e.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, ctx.admin);

    ctx.e.set_auths(&[]);
    assert!(ctx.pool.try_advance_clock(&DAY).is_err());
    ctx.e.mock_all_auths();
    assert_eq!(ctx.pool.protocol_now(), START + DAY);
}

#[test]
fn advance_clock_is_capped_and_monotonic() {
    let ctx = Ctx::new(default_params(), 0);
    assert_eq!(
        ctx.pool.try_advance_clock(&0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        ctx.pool.try_advance_clock(&(MAX_CLOCK_ADVANCE_SECS + 1)),
        Err(Ok(Error::ClockAdvanceTooLarge))
    );

    let mut last = ctx.pool.protocol_now();
    for secs in [1, DAY, 7 * DAY, MAX_CLOCK_ADVANCE_SECS] {
        ctx.pool.advance_clock(&secs);
        let events = ctx.e.events().all().filter_by_contract(&ctx.pool.address);
        assert_eq!(
            events.events().last().unwrap(),
            &ClockAdvanced {
                secs,
                protocol_now: last + secs
            }
            .to_xdr(&ctx.e, &ctx.pool.address)
        );
        let now = ctx.pool.protocol_now();
        assert_eq!(now, last + secs);
        last = now;
    }
    // The offset only grows; real time keeps adding on top.
    ctx.e.ledger().set_timestamp(START + 10);
    assert_eq!(ctx.pool.protocol_now(), last + 10);
}

#[test]
fn advance_clock_accrues_first() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    ctx.note(&agent, 15_000 * EUR, 300);
    ctx.draw(&agent, 3_000 * EUR);

    // 10 real days pass without any pool call, then a 30-day fast-forward.
    ctx.e.ledger().set_timestamp(START + 10 * DAY);
    ctx.advance_days(30);

    // Interest up to the old clock was booked before the offset moved: one
    // 10-day step on the index, stamped at the pre-advance time.
    let step = |index: i128, days: i128| index + index * 1200 * days * 86_400 / (BPS * YEAR);
    let after_10 = step(SCALE, 10);
    assert_eq!(stored::<i128>(&ctx, DataKey::BorrowIndex), after_10);
    assert_eq!(stored::<u64>(&ctx, DataKey::LastAccrual), START + 10 * DAY);
    assert_eq!(stored::<u64>(&ctx, DataKey::DemoOffset), 30 * DAY);

    // The next touch books the 30 fast-forwarded days as a second step
    // (views show it already).
    let after_40 = step(after_10, 30);
    assert_eq!(ctx.stats().borrow_index, after_40);
    ctx.pool.accrue();
    assert_eq!(stored::<i128>(&ctx, DataKey::BorrowIndex), after_40);
    assert_eq!(stored::<u64>(&ctx, DataKey::LastAccrual), START + 40 * DAY);
    // Compounded twice: slightly more than one 40-day simple step.
    assert!(after_40 > step(SCALE, 40));
    ctx.assert_invariant();
}

#[test]
fn views_preview_accrual_without_writing() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 300);
    ctx.draw(&agent, 3_000 * EUR);
    ctx.advance_days(30);
    let index_before: i128 = stored(&ctx, DataKey::BorrowIndex);
    let view = ctx.pool.line(&note_id);
    let stats = ctx.stats();
    let position = ctx.position(&agent);
    assert!(view.interest > 0);
    assert_eq!(position.total_debt, view.debt);
    assert!(stats.borrow_index > index_before);
    // Nothing was written by the views.
    assert_eq!(stored::<i128>(&ctx, DataKey::BorrowIndex), index_before);
    assert_eq!(stored::<u64>(&ctx, DataKey::LastAccrual), START);
}

#[test]
fn ttls_are_extended() {
    let ctx = Ctx::new(default_params(), 1_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    let auth_ref = ctx.auth_ref();
    ctx.pool.card_draw(&agent, &EUR, &auth_ref);
    let day = 17_280;
    let pool = ctx.pool.address.clone();
    ctx.e.as_contract(&pool, || {
        let storage = ctx.e.storage();
        assert_eq!(storage.instance().get_ttl(), 30 * day);
        assert_eq!(
            storage.persistent().get_ttl(&DataKey::Line(note_id)),
            90 * day
        );
        assert_eq!(
            storage.persistent().get_ttl(&DataKey::Agent(agent.clone())),
            90 * day
        );
        assert_eq!(
            storage
                .persistent()
                .get_ttl(&DataKey::Draw(auth_ref.clone())),
            90 * day
        );
    });
    // 50 days later a read extends the agent and its lines again.
    ctx.e.ledger().with_mut(|l| l.sequence_number += 50 * day);
    ctx.position(&agent);
    ctx.e.as_contract(&pool, || {
        let storage = ctx.e.storage();
        assert_eq!(storage.instance().get_ttl(), 30 * day);
        assert_eq!(
            storage.persistent().get_ttl(&DataKey::Line(note_id)),
            90 * day
        );
        assert_eq!(
            storage.persistent().get_ttl(&DataKey::Agent(agent.clone())),
            90 * day
        );
    });
}
