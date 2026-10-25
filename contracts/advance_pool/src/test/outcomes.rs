//! Deal outcomes: settle, cancel, grace and write-off (spec §4.5, §4.6, §7.3).

use advance_shared::Error;
use soroban_sdk::{testutils::Events as _, Event as _};

use super::*;
use crate::{DebtWrittenOff, LineStatus, NoteCancelled, NoteSettled};

fn last_pool_event(ctx: &Ctx) -> soroban_sdk::xdr::ContractEvent {
    ctx.e
        .events()
        .all()
        .filter_by_contract(&ctx.pool.address)
        .events()
        .last()
        .unwrap()
        .clone()
}

#[test]
fn settle_without_carried_debt() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.draw(&agent, 1_000 * EUR);
    let before = ctx.stats();
    let treasury_before = ctx.token.balance(&ctx.treasury);

    ctx.pool.settle(&note_id);
    // Operator and treasury both authorized.
    let signers: std::vec::Vec<Address> = ctx.e.auths().iter().map(|a| a.0.clone()).collect();
    assert!(signers.contains(&ctx.operator));
    assert!(signers.contains(&ctx.treasury));
    assert_eq!(
        last_pool_event(&ctx),
        NoteSettled {
            note_id,
            agent: agent.clone(),
            total_commission: 15_000 * EUR,
            debt_repaid: 1_000 * EUR,
            interest_paid: 0,
            carried_repaid: 0,
            agent_payout: 6_500 * EUR,
            junior_deposit: 7_500 * EUR,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );

    let after = ctx.stats();
    assert_eq!(
        ctx.token.balance(&ctx.treasury),
        treasury_before - 15_000 * EUR
    );
    assert_eq!(after.junior_assets, before.junior_assets + 7_500 * EUR);
    assert_eq!(after.total_debt, 0);
    assert_eq!(after.total_card_balances, 6_500 * EUR);
    let position = ctx.position(&agent);
    assert_eq!(position.card_balance, 6_500 * EUR);
    assert!(position.lines.is_empty());
    assert_eq!(position.grace_deadline, None);
    assert_eq!(ctx.pool.line(&note_id).line.status, LineStatus::Settled);
    assert_eq!(ctx.pool.line(&note_id).debt, 0);
    assert_eq!(ctx.notes.get(&note_id).status, NoteStatus::Settled);

    // A settled note cannot be settled or cancelled again.
    assert_eq!(ctx.pool.try_settle(&note_id), Err(Ok(Error::LineNotActive)));
    assert_eq!(ctx.pool.try_cancel(&note_id), Err(Ok(Error::LineNotActive)));
    assert_eq!(ctx.pool.try_settle(&404), Err(Ok(Error::UnknownNote)));
    ctx.assert_invariant();
}

#[test]
fn settle_needs_the_treasury() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.e.set_auths(&[]);
    assert!(ctx.pool.try_settle(&note_id).is_err());
    ctx.e.mock_all_auths();
    assert_eq!(ctx.pool.line(&note_id).line.status, LineStatus::Active);
}

#[test]
fn settle_repays_carried_debt_first() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let lost = ctx.note(&agent, 8_000 * EUR, 30); // limit €2,000
    let good = ctx.note(&agent, 15_000 * EUR, 90); // limit €3,750
                                                   // Earliest escritura first: the €1,500 draw lands on `lost`.
    ctx.draw(&agent, 1_500 * EUR);
    ctx.pool.cancel(&lost);
    let position = ctx.position(&agent);
    assert_eq!(position.carried_debt, 1_500 * EUR);
    // Carried debt reduces the credit available on the other notes.
    assert_eq!(position.available_credit, 3_750 * EUR - 1_500 * EUR);
    assert_eq!(position.grace_deadline, Some(START + 180 * DAY));

    ctx.draw(&agent, 1_000 * EUR); // on `good`
    ctx.advance_days(30);
    let carried = ctx.position(&agent).carried_debt;
    let line_debt = ctx.pool.line(&good).debt;
    assert!(carried > 1_500 * EUR && line_debt > 1_000 * EUR);

    ctx.pool.settle(&good);
    let payout = 7_500 * EUR - line_debt - carried;
    assert_eq!(
        last_pool_event(&ctx),
        NoteSettled {
            note_id: good,
            agent: agent.clone(),
            total_commission: 15_000 * EUR,
            debt_repaid: line_debt,
            interest_paid: line_debt - 1_000 * EUR,
            carried_repaid: carried,
            agent_payout: payout,
            junior_deposit: 7_500 * EUR,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    let position = ctx.position(&agent);
    assert_eq!(position.carried_debt, 0);
    assert_eq!(position.grace_deadline, None);
    assert_eq!(position.card_balance, payout);
    assert_eq!(position.total_debt, 0);
    assert_eq!(ctx.stats().total_debt, 0);
    assert_eq!(ctx.stats().total_principal, 0);
    ctx.assert_invariant();
}

#[test]
fn settle_partially_repays_large_carried_debt() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let lost = ctx.note(&agent, 40_000 * EUR, 30); // limit €10,000
    let small = ctx.note(&agent, 2_000 * EUR, 90); // agent half €1,000
    ctx.draw(&agent, 9_000 * EUR); // all on `lost`
    ctx.pool.cancel(&lost);
    let deadline = ctx.position(&agent).grace_deadline;
    assert!(deadline.is_some());

    ctx.pool.settle(&small);
    let position = ctx.position(&agent);
    // The whole €1,000 half went to the carried debt; nothing paid out.
    assert_eq!(position.card_balance, 0);
    assert_close(position.carried_debt, 8_000 * EUR, 2);
    assert!(position.carried_debt >= 8_000 * EUR);
    // The grace period keeps running from the cancellation.
    assert_eq!(position.grace_deadline, deadline);
    assert_eq!(position.total_principal, 8_000 * EUR);
    ctx.assert_invariant();
}

#[test]
fn settle_when_debt_exceeds_the_agents_half() {
    // LTV 100%: the agent can borrow their whole half; a year and a bit of
    // interest then pushes the debt above it.
    let ctx = Ctx::new(
        Params {
            ltv_bps: 10_000,
            ..default_params()
        },
        100_000 * EUR,
    );
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.draw(&agent, 7_500 * EUR);
    ctx.advance_days(400);
    let debt = ctx.pool.line(&note_id).debt;
    assert!(debt > 7_500 * EUR);
    let before = ctx.stats();

    ctx.pool.settle(&note_id);
    let interest = debt - 7_500 * EUR;
    assert_eq!(
        last_pool_event(&ctx),
        NoteSettled {
            note_id,
            agent: agent.clone(),
            total_commission: 15_000 * EUR,
            debt_repaid: 7_500 * EUR,
            interest_paid: interest,
            carried_repaid: 0,
            agent_payout: 0,
            junior_deposit: 7_500 * EUR,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    let position = ctx.position(&agent);
    assert_eq!(position.card_balance, 0);
    // The shortfall became carried debt, with a grace period.
    assert_close(position.carried_debt, debt - 7_500 * EUR, 2);
    assert!(position.carried_debt >= debt - 7_500 * EUR);
    assert_eq!(
        position.grace_deadline,
        Some(ctx.pool.protocol_now() + 180 * DAY)
    );
    // Interest is paid first: the unpaid shortfall is principal.
    assert_eq!(position.total_principal, interest);
    assert!(position.lines.is_empty());
    let after = ctx.stats();
    // +€7,500, plus at most 2 stroops of rounding surplus.
    assert_close(after.junior_assets - before.junior_assets, 7_500 * EUR, 2);
    assert!(after.junior_assets - before.junior_assets >= 7_500 * EUR);
    assert_eq!(ctx.notes.get(&note_id).status, NoteStatus::Settled);
    ctx.assert_invariant();
}

#[test]
fn cancel_then_write_off_hits_junior_only() {
    // Spec §5.6 loss illustration: €2,000 carried debt written off; junior
    // absorbs it, senior is untouched.
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.draw(&agent, 2_000 * EUR);

    ctx.pool.cancel(&note_id);
    let deadline = START + 180 * DAY;
    assert_eq!(
        last_pool_event(&ctx),
        NoteCancelled {
            note_id,
            agent: agent.clone(),
            debt_carried: 2_000 * EUR,
            grace_deadline: Some(deadline),
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    assert_eq!(ctx.notes.get(&note_id).status, NoteStatus::Cancelled);
    let view = ctx.pool.line(&note_id);
    assert_eq!(view.line.status, LineStatus::Cancelled);
    assert_eq!((view.debt, view.available), (0, 0));
    let position = ctx.position(&agent);
    assert_eq!(position.carried_debt, 2_000 * EUR);
    assert!(position.lines.is_empty());
    assert_eq!(position.available_credit, 0);

    // Not before the grace deadline.
    assert_eq!(ctx.pool.try_write_off(&agent), Err(Ok(Error::GraceNotOver)));
    ctx.advance_days(179);
    assert_eq!(ctx.pool.try_write_off(&agent), Err(Ok(Error::GraceNotOver)));
    ctx.advance_days(1);
    assert_eq!(ctx.pool.protocol_now(), deadline);

    // Interest kept running during the grace period.
    ctx.pool.accrue();
    let before = ctx.stats();
    let loss = ctx.position(&agent).carried_debt;
    assert!(loss > 2_000 * EUR);
    ctx.pool.write_off(&agent);
    let event = last_pool_event(&ctx);
    let after = ctx.stats();

    assert_close(before.junior_assets - after.junior_assets, loss, 1);
    assert_eq!(after.senior_assets, before.senior_assets);
    assert_eq!(after.share_price_scaled, before.share_price_scaled);
    assert_eq!(after.total_debt, 0);
    assert_eq!(after.total_principal, 0);
    assert_eq!(after.written_off_total, loss);
    assert_eq!(
        event,
        DebtWrittenOff {
            agent: agent.clone(),
            amount: loss,
            junior_loss: before.junior_assets - after.junior_assets,
            senior_loss: 0,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    let position = ctx.position(&agent);
    assert!(position.blocked);
    assert_eq!(position.carried_debt, 0);
    assert_eq!(position.grace_deadline, None);
    assert_eq!(
        ctx.pool.try_write_off(&agent),
        Err(Ok(Error::NothingToWriteOff))
    );
    ctx.assert_invariant();
}

#[test]
fn write_off_reaches_senior_only_after_junior_is_exhausted() {
    // Junior €1,000 (leverage cap €10,000); a €3,000 loss.
    let ctx = Ctx::bare(default_params());
    ctx.pool.junior_deposit(&(1_000 * EUR));
    ctx.investor(100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.draw(&agent, 3_000 * EUR);
    ctx.pool.cancel(&note_id);
    ctx.advance_days(180);
    ctx.pool.accrue();

    let before = ctx.stats();
    let loss = ctx.position(&agent).carried_debt;
    assert!(loss > before.junior_assets);
    ctx.pool.write_off(&agent);
    let event = last_pool_event(&ctx);
    let after = ctx.stats();

    assert_eq!(after.junior_assets, 0);
    let senior_loss = before.senior_assets - after.senior_assets;
    assert_close(senior_loss, loss - before.junior_assets, 1);
    assert!(after.share_price_scaled < before.share_price_scaled);
    assert_eq!(
        event,
        DebtWrittenOff {
            agent: agent.clone(),
            amount: loss,
            junior_loss: before.junior_assets,
            senior_loss,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    ctx.assert_invariant();
}

#[test]
fn cancel_uses_the_card_balance_first() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let paid = ctx.note(&agent, 3_000 * EUR, 10);
    ctx.pool.settle(&paid); // €1,500 card balance
    let small = ctx.note(&agent, 15_000 * EUR, 90);
    let big = ctx.note(&agent, 40_000 * EUR, 120);

    // Draw on `small` only (€500 credit after the €1,500 balance).
    ctx.draw(&agent, 2_000 * EUR);
    assert_eq!(ctx.position(&agent).card_balance, 0);
    let paid_again = ctx.note(&agent, 2_000 * EUR, 5);
    ctx.pool.settle(&paid_again); // €1,000 card balance
    ctx.pool.cancel(&small);
    // €500 of carried debt repaid at once from the €1,000 balance: nothing
    // left carried, no grace period.
    let position = ctx.position(&agent);
    assert_eq!(position.carried_debt, 0);
    assert_eq!(position.card_balance, 500 * EUR);
    assert_eq!(position.grace_deadline, None);
    assert_eq!(ctx.stats().total_card_balances, 500 * EUR);

    // Partial cover: the balance runs out and the rest stays carried.
    ctx.draw(&agent, 3_500 * EUR); // €500 balance + €3,000 credit on `big`
    let paid_third = ctx.note(&agent, 1_000 * EUR, 5);
    ctx.pool.settle(&paid_third); // €500 card balance
    ctx.pool.cancel(&big);
    let position = ctx.position(&agent);
    assert_eq!(position.card_balance, 0);
    assert_close(position.carried_debt, 2_500 * EUR, 2);
    assert!(position.carried_debt >= 2_500 * EUR);
    assert!(position.grace_deadline.is_some());
    ctx.assert_invariant();
}

#[test]
fn outcome_functions_are_operator_only() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.pool.cancel(&note_id);
    assert_eq!(ctx.e.auths()[0].0, ctx.operator);
    ctx.e.set_auths(&[]);
    assert!(ctx.pool.try_write_off(&agent).is_err());
    assert!(ctx.pool.try_set_blocked(&agent, &true).is_err());
    ctx.e.mock_all_auths();
    // Cancelled with no debt: nothing carried, nothing to write off.
    assert_eq!(ctx.position(&agent).grace_deadline, None);
    assert_eq!(
        ctx.pool.try_write_off(&agent),
        Err(Ok(Error::NothingToWriteOff))
    );
}

#[test]
fn junior_and_fee_limits() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    ctx.draw(&agent, 3_000 * EUR);
    ctx.advance_days(90);
    ctx.pool.settle(&note_id);
    let stats = ctx.stats();
    assert!(stats.fees_accrued > 0);

    // Fees: up to what has accrued.
    assert_eq!(
        ctx.pool.try_claim_fees(&(stats.fees_accrued + 1)),
        Err(Ok(Error::InvalidAmount))
    );
    let treasury_before = ctx.token.balance(&ctx.treasury);
    ctx.pool.claim_fees(&stats.fees_accrued);
    assert_eq!(ctx.e.auths()[0].0, ctx.treasury);
    assert_eq!(
        ctx.token.balance(&ctx.treasury),
        treasury_before + stats.fees_accrued
    );
    assert_eq!(ctx.stats().fees_accrued, 0);

    // Junior: up to junior assets.
    let junior = ctx.stats().junior_assets;
    assert_eq!(
        ctx.pool.try_junior_withdraw(&(junior + 1)),
        Err(Ok(Error::InvalidAmount))
    );
    ctx.pool.junior_withdraw(&(1_000 * EUR));
    assert_eq!(ctx.stats().junior_assets, junior - 1_000 * EUR);
    assert_eq!(
        ctx.pool.try_junior_deposit(&0),
        Err(Ok(Error::InvalidAmount))
    );
    ctx.assert_invariant();
}

#[test]
fn junior_withdraw_is_capped_by_lendable_cash() {
    // Junior only (no senior): lend most of it, then try to pull it out.
    let ctx = Ctx::new(default_params(), 0);
    let agent = ctx.agent();
    ctx.note(&agent, 100_000 * EUR, 90);
    ctx.draw(&agent, 9_000 * EUR);
    assert_eq!(ctx.stats().lendable, 1_000 * EUR);
    assert_eq!(
        ctx.pool.try_junior_withdraw(&(1_000 * EUR + 1)),
        Err(Ok(Error::InsufficientLiquidity))
    );
    ctx.pool.junior_withdraw(&(1_000 * EUR));
    assert_eq!(ctx.stats().lendable, 0);
    assert_eq!(ctx.stats().junior_assets, 9_000 * EUR);
    assert_eq!(
        ctx.pool.try_junior_withdraw(&1),
        Err(Ok(Error::InsufficientLiquidity))
    );
    ctx.assert_invariant();
}
