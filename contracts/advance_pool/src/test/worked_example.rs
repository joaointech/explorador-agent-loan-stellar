//! Spec §5.6 worked example, with its exact numbers.

use advance_shared::math::{BPS, SCALE, YEAR};
use soroban_sdk::{testutils::Events as _, Event as _};

use super::*;
use crate::NoteSettled;

/// Senior €100,000, junior €10,000; a €15,000-commission note (sale €300,000
/// at 5%): agent €7,500, explorador €7,500, credit limit €3,750. The agent
/// spends €3,000 on day 0.
fn example() -> (Ctx, Address, u32) {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    let line = ctx.pool.line(&note_id);
    assert_eq!(line.line.credit_limit, 3_750 * EUR);
    assert_eq!(line.available, 3_750 * EUR);
    assert_eq!(
        ctx.draw(&agent, 3_000 * EUR),
        DrawResult {
            from_balance: 0,
            from_credit: 3_000 * EUR
        }
    );
    assert_eq!(ctx.token.balance(&ctx.card_settlement), 3_000 * EUR);
    (ctx, agent, note_id)
}

fn settled_event(ctx: &Ctx) -> NoteSettled {
    let events = ctx.e.events().all().filter_by_contract(&ctx.pool.address);
    let raw = events.events().last().unwrap().clone();
    // Decode by comparing against candidates is awkward; read the fields from
    // the data map instead.
    let soroban_sdk::xdr::ContractEventBody::V0(body) = raw.body;
    let soroban_sdk::xdr::ScVal::Map(Some(map)) = body.data else {
        panic!("note_settled data is not a map")
    };
    let field = |name: &str| -> i128 {
        let entry = map
            .iter()
            .find(|e| e.key == soroban_sdk::xdr::ScVal::Symbol(name.try_into().unwrap()))
            .unwrap();
        match &entry.val {
            soroban_sdk::xdr::ScVal::I128(parts) => ((parts.hi as i128) << 64) | (parts.lo as i128),
            other => panic!("{name}: {other:?}"),
        }
    };
    let note_id = match &map
        .iter()
        .find(|e| e.key == soroban_sdk::xdr::ScVal::Symbol("note_id".try_into().unwrap()))
        .unwrap()
        .val
    {
        soroban_sdk::xdr::ScVal::U32(v) => *v,
        other => panic!("note_id: {other:?}"),
    };
    let agent = ctx.notes.get(&note_id).agent;
    NoteSettled {
        note_id,
        agent,
        total_commission: field("total_commission"),
        debt_repaid: field("debt_repaid"),
        interest_paid: field("interest_paid"),
        carried_repaid: field("carried_repaid"),
        agent_payout: field("agent_payout"),
        junior_deposit: field("junior_deposit"),
    }
}

#[test]
fn single_accrual_matches_the_spec() {
    let (ctx, agent, note_id) = example();

    // Escritura 90 days later, with no other pool activity in between.
    ctx.advance_days(90);
    // Views already include the interest (non-mutating preview).
    assert_close(ctx.pool.line(&note_id).interest, 8_877 * CENT, CENT);
    let before = ctx.stats();

    ctx.pool.settle(&note_id);
    let event = settled_event(&ctx);
    let after = ctx.stats();

    // Interest = €3,000 × 12% × 90/365 = €88.77.
    assert_close(event.interest_paid, 8_877 * CENT, CENT);
    assert_close(event.debt_repaid, 308_877 * CENT, CENT);
    // €4,411.23 to the agent's card balance, €7,500 to the junior tranche.
    assert_close(event.agent_payout, 441_123 * CENT, CENT);
    assert_eq!(event.junior_deposit, 7_500 * EUR);
    assert_eq!(event.carried_repaid, 0);
    assert_eq!(event.total_commission, 15_000 * EUR);
    assert_eq!(event.agent, agent);
    // Protocol fee €8.88, €79.89 to the tranches (all to senior: its 8%
    // target on €100,000 over 90 days is far above that).
    assert_close(after.fees_accrued, 888 * CENT, CENT);
    assert_close(after.senior_assets - 100_000 * EUR, 7_989 * CENT, CENT);

    // The same numbers to the stroop.
    let index = SCALE + SCALE * 1200 * (90 * DAY as i128) / (BPS * YEAR);
    assert_eq!(index, 1_029_589_041_095_890_410);
    assert_eq!(after.borrow_index, index);
    assert_eq!(event.debt_repaid, 30_887_671_233); // ceil(3e10 × index / SCALE)
    assert_eq!(event.interest_paid, 887_671_233);
    assert_eq!(event.agent_payout, 44_112_328_767);
    assert_eq!(after.fees_accrued, 88_767_123);
    assert_eq!(after.senior_assets, 100_000 * EUR + 798_904_109);
    // Junior: +€7,500, plus the 1-stroop rounding surplus of rounding the
    // debt up (booked to junior to keep the invariant exact).
    assert_eq!(after.junior_assets - before.junior_assets, 7_500 * EUR + 1);
    assert_eq!(after.junior_assets, 17_500 * EUR + 1);

    let position = ctx.position(&agent);
    assert_eq!(position.card_balance, 44_112_328_767);
    assert_eq!(position.total_debt, 0);
    assert!(position.lines.is_empty());
    assert_eq!(after.total_debt, 0);
    assert_eq!(after.total_principal, 0);
    assert_eq!(
        ctx.pool.line(&note_id).line.status,
        crate::LineStatus::Settled
    );
    assert_eq!(ctx.notes.get(&note_id).status, NoteStatus::Settled);
    // Settlement turned accrued interest into cash: the share price is up.
    assert!(after.share_price_scaled > SCALE);
    ctx.assert_invariant();
}

#[test]
fn daily_accruals_compound_to_about_90_08() {
    let (ctx, _agent, note_id) = example();

    // 90 daily touches: each fast-forward books the previous day first.
    for _ in 0..90 {
        ctx.advance_days(1);
    }
    ctx.pool.settle(&note_id);
    let event = settled_event(&ctx);

    // ≈ €90.08 instead of €88.77 (spec §5.6).
    assert_close(event.interest_paid, 9_008 * CENT, CENT);
    assert_close(event.agent_payout, 7_500 * EUR - 309_008 * CENT, CENT);

    // Exactly the index recurrence of spec §5.2, one step per day.
    let mut index = SCALE;
    for _ in 0..90 {
        index += index * 1200 * (DAY as i128) / (BPS * YEAR);
    }
    assert_eq!(ctx.stats().borrow_index, index);
    let debt = (3_000 * EUR * index + SCALE - 1) / SCALE;
    assert_eq!(event.debt_repaid, debt);
    assert_eq!(event.interest_paid, debt - 3_000 * EUR);
    ctx.assert_invariant();
}

#[test]
fn settled_event_layout() {
    let (ctx, agent, note_id) = example();
    ctx.pool.settle(&note_id);
    // Settled the same day: no interest at all.
    let expected = NoteSettled {
        note_id,
        agent,
        total_commission: 15_000 * EUR,
        debt_repaid: 3_000 * EUR,
        interest_paid: 0,
        carried_repaid: 0,
        agent_payout: 4_500 * EUR,
        junior_deposit: 7_500 * EUR,
    };
    let events = ctx.e.events().all().filter_by_contract(&ctx.pool.address);
    assert_eq!(
        events.events().last().unwrap(),
        &expected.to_xdr(&ctx.e, &ctx.pool.address)
    );
    assert_eq!(settled_event(&ctx), expected);
}

/// Spec §5.6 yield illustration: senior €100,000, junior €10,000, a year of
/// interest on `debt` booked in one accrual.
fn year_of_interest(debt: i128) -> (PoolStats, PoolStats) {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    // Credit limit = total commission × 25%.
    ctx.note(&agent, debt * 4, 400);
    ctx.draw(&agent, debt);
    let before = ctx.stats();
    ctx.advance_days(365);
    ctx.pool.accrue();
    let after = ctx.stats();
    ctx.assert_invariant();
    (before, after)
}

#[test]
fn yield_illustration_debt_60k() {
    // Net interest €6,480/yr: all of it to senior (6.48% < 8% target).
    let (before, after) = year_of_interest(60_000 * EUR);
    assert_eq!(after.total_debt - before.total_debt, 7_200 * EUR);
    assert_eq!(after.fees_accrued, 720 * EUR);
    assert_eq!(after.senior_assets - before.senior_assets, 6_480 * EUR);
    assert_eq!(after.junior_assets, before.junior_assets);
}

#[test]
fn yield_illustration_debt_90k() {
    // Net interest €9,720/yr: senior gets its 8% (€8,000), junior €1,720.
    let (before, after) = year_of_interest(90_000 * EUR);
    assert_eq!(before.utilization_bps, 8_181); // 90k / (90k + 20k lendable)
    assert_eq!(before.leverage_x100, 900);
    assert_eq!(after.total_debt - before.total_debt, 10_800 * EUR);
    assert_eq!(after.fees_accrued, 1_080 * EUR);
    assert_eq!(after.senior_assets - before.senior_assets, 8_000 * EUR);
    assert_eq!(after.junior_assets - before.junior_assets, 1_720 * EUR);
    assert_eq!(
        after.share_price_scaled,
        (108_000 * EUR + 1) * SCALE / (100_000 * EUR + 1)
    );
}

#[test]
fn loss_illustration() {
    // €2,000 of carried debt written off: junior €10,000 → €8,000, senior
    // untouched. (No grace period, so no interest accrues before the loss.)
    let ctx = Ctx::new(
        Params {
            grace_period_secs: 0,
            ..default_params()
        },
        100_000 * EUR,
    );
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.draw(&agent, 2_000 * EUR);
    ctx.pool.cancel(&note_id);
    ctx.pool.write_off(&agent);
    let stats = ctx.stats();
    assert_eq!(stats.junior_assets, 8_000 * EUR);
    assert_eq!(stats.senior_assets, 100_000 * EUR);
    assert_eq!(stats.written_off_total, 2_000 * EUR);
    ctx.assert_invariant();
}

// The constructor fails with Error::InvalidAmount (contract error 3).
#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_a_fee_above_100_percent() {
    Ctx::bare(Params {
        protocol_fee_bps: 10_001,
        ..default_params()
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_zero_leverage() {
    Ctx::bare(Params {
        max_leverage: 0,
        ..default_params()
    });
}

#[test]
fn params_are_stored() {
    let params = Params {
        ltv_bps: 4_000,
        demo_mode: false,
        ..default_params()
    };
    let ctx = Ctx::bare(params.clone());
    assert_eq!(ctx.pool.params(), params);
    assert_eq!(ctx.stats().params, params);
}
