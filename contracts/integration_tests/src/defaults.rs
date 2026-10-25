//! Spec §4.6 on the real contracts: the buyer walks away. Cancel moves the
//! line debt to the agent's carried debt with a 180-day grace deadline,
//! interest keeps running, and after the deadline the write-off takes the
//! loss from junior first (then senior) and blocks the agent. The note stays
//! Cancelled in the public registry.

use advance_pool::{DebtWrittenOff, LineStatus, NoteCancelled, PoolStats};
use advance_shared::{Error, NoteStatus};
use cpcv_note::NoteStatusChanged;
use soroban_sdk::{Address, Event as _};

use crate::{fixture::NOTES, harness::*};

/// Writes off `agent` and checks the event and the tranche movements against
/// the views before and after: the book debt falls by `booked`, junior
/// absorbs it first, senior the rest; `amount` is the displayed carried debt
/// (rounded up, so at most 1 stroop above `booked`).
fn write_off_and_check(ctx: &Ctx, agent: &Address) -> (Cost, PoolStats, PoolStats) {
    let carried = ctx.position(agent).carried_debt;
    let before = ctx.stats();
    let out = ctx.write_off(agent);
    let after = ctx.stats();
    let booked = before.total_debt - after.total_debt;
    assert!(
        carried == booked || carried == booked + 1,
        "{carried} vs {booked}"
    );
    let junior_loss = booked.min(before.junior_assets);
    let senior_loss = booked - junior_loss;
    assert_eq!(
        ctx.emitted(&out.events, &ctx.pool.address),
        [DebtWrittenOff {
            agent: agent.clone(),
            amount: carried,
            junior_loss,
            senior_loss,
        }
        .to_xdr(&ctx.env, &ctx.pool.address)]
    );
    assert_eq!(after.junior_assets, before.junior_assets - junior_loss);
    assert_eq!(after.senior_assets, before.senior_assets - senior_loss);
    assert_eq!(after.fees_accrued, before.fees_accrued);
    assert_eq!(after.written_off_total, before.written_off_total + carried);
    let position = ctx.position(agent);
    assert!(position.blocked);
    assert_eq!(position.carried_debt, 0);
    assert_eq!(position.grace_deadline, None);
    assert_eq!(position.available_credit, 0);
    (out.cost, before, after)
}

/// Costs of the cancel and write-off transactions.
pub struct Costs {
    pub cancel: Cost,
    pub write_off: Cost,
}

/// Agent B (fixture note 2) draws €2,000, the buyer walks away 30 days later,
/// and the debt is written off at the grace deadline. Runs on a freshly
/// deployed `ctx`.
pub fn buyer_walks_away(ctx: &Ctx) -> Costs {
    let b = ctx.agent(2);
    let id = ctx.mint(2).value;
    ctx.enable_card(&b);
    ctx.draw(&b, 2_000 * EUR);

    // 30 days on, the buyer withdraws.
    ctx.advance_days(30);
    let debt = mul_div_ceil(2_000 * EUR, accrue_index(SCALE, 30), SCALE);
    assert_eq!(ctx.pool.line(&id).debt, debt);
    let cancel = ctx.cancel(id);
    let deadline = start() + (30 + 180) * DAY;
    assert_eq!(
        ctx.event_names(&cancel.events),
        [
            "cpcv_note:note_status_changed",
            "advance_pool:note_cancelled"
        ]
    );
    assert_eq!(
        ctx.emitted(&cancel.events, &ctx.pool.address),
        [NoteCancelled {
            note_id: id,
            agent: b.clone(),
            debt_carried: debt,
            grace_deadline: Some(deadline),
        }
        .to_xdr(&ctx.env, &ctx.pool.address)]
    );
    assert_eq!(
        ctx.emitted(&cancel.events, &ctx.notes.address),
        [NoteStatusChanged {
            id,
            status: NoteStatus::Cancelled
        }
        .to_xdr(&ctx.env, &ctx.notes.address)]
    );
    // Both contracts record the cancellation.
    assert_eq!(ctx.notes.get(&id).status, NoteStatus::Cancelled);
    assert_eq!(
        ctx.notes.list(&0, &50).get(0).unwrap().status,
        NoteStatus::Cancelled
    );
    let line = ctx.pool.line(&id);
    assert_eq!(line.line.status, LineStatus::Cancelled);
    assert_eq!((line.debt, line.available), (0, 0));
    let position = ctx.position(&b);
    assert_eq!(position.carried_debt, debt);
    assert_eq!(position.grace_deadline, Some(deadline));
    assert!(position.lines.is_empty());
    assert_eq!((position.available_credit, position.borrowable_now), (0, 0));
    assert!(!position.blocked);
    // The debt moved, it was not repaid: the pool still lends it out.
    assert_eq!(ctx.stats().total_principal, 2_000 * EUR);
    assert_eq!(ctx.try_draw(&b, EUR), Error::InsufficientCredit);

    // No write-off before the deadline.
    assert_eq!(ctx.try_write_off(&b), Error::GraceNotOver);
    ctx.advance_days(179);
    assert_eq!(ctx.try_write_off(&b), Error::GraceNotOver);
    ctx.advance_days(1);
    assert_eq!(ctx.pool.protocol_now(), deadline);

    // Interest kept running during the grace period.
    let carried = ctx.position(&b).carried_debt;
    assert!(carried > debt);
    ctx.step(|| ctx.pool.accrue());
    let before = ctx.stats();
    // Net interest stayed below senior's 8% target, so junior is still the
    // seed: it absorbs the whole loss, senior none of it.
    assert_eq!(before.junior_assets, JUNIOR_SEED);
    let (write_off, _, after) = write_off_and_check(ctx, &b);
    assert_eq!(after.junior_assets, JUNIOR_SEED - before.total_debt);
    assert_eq!(after.senior_assets, before.senior_assets);
    assert_eq!((after.total_debt, after.total_principal), (0, 0));

    // Blocked: no new credit; the note stays Cancelled.
    assert_eq!(ctx.try_draw(&b, EUR), Error::AgentBlocked);
    assert_eq!(ctx.notes.get(&id).status, NoteStatus::Cancelled);
    assert_eq!(ctx.pool.line(&id).line.status, LineStatus::Cancelled);

    Costs {
        cancel: cancel.cost,
        write_off,
    }
}

e2e! {
    fn cancel_grace_then_write_off_hits_junior_and_blocks_the_agent(code: Code) {
        let ctx = Ctx::deploy(code);
        let costs = buyer_walks_away(&ctx);
        costs.cancel.assert_fits_testnet("cancel");
        costs.write_off.assert_fits_testnet("write_off");
    }
}

e2e! {
    /// Every fixture note defaults with its credit fully drawn (€10,479.25 in
    /// total, more than the €10,000 junior tranche): junior is wiped out first,
    /// senior takes only the rest, and the share price falls.
    fn defaults_wipe_out_junior_before_senior(code: Code) {
        let ctx = Ctx::deploy(code);
        let (a, b) = (ctx.agent(0), ctx.agent(2));
        for i in 0..3 {
            ctx.mint(i);
        }
        ctx.enable_card(&a);
        ctx.enable_card(&b);

        // Agent A spends both lines in one purchase of exactly what the
        // position reports as borrowable (what the card ASA approves against):
        // note 2 (earliest escritura) first, then note 1. B spends their line.
        let limit_a = NOTES[1].agent_commission_cents as i128 * CENT / 2 + 3_750 * EUR;
        assert_eq!(ctx.position(&a).borrowable_now, limit_a);
        assert_eq!(ctx.draw(&a, limit_a).value.from_credit, limit_a);
        let lines = ctx.position(&a).lines;
        assert_eq!(lines.get(0).unwrap().line.note_id, 2);
        assert!(lines.iter().all(|v| v.available == 0));
        assert_eq!(ctx.position(&a).borrowable_now, 0);
        assert_eq!(ctx.try_draw(&a, 1), Error::InsufficientCredit);
        let limit_b = NOTES[2].agent_commission_cents as i128 * CENT / 2;
        assert_eq!(ctx.position(&b).borrowable_now, limit_b);
        ctx.draw(&b, limit_b);
        assert_eq!(ctx.stats().total_debt, limit_a + limit_b);

        // All three buyers walk away.
        for id in [2, 1, 3] {
            ctx.cancel(id);
        }
        let deadline = start() + 180 * DAY;
        assert_eq!(ctx.position(&a).grace_deadline, Some(deadline));
        assert_eq!(ctx.position(&b).grace_deadline, Some(deadline));
        assert_eq!(ctx.position(&a).carried_debt, limit_a);

        ctx.advance_days(180);
        ctx.step(|| ctx.pool.accrue());
        assert_eq!(ctx.stats().junior_assets, JUNIOR_SEED);

        // A's loss (≈ €8,958.67) fits in junior: senior is untouched.
        let (_, before_a, after_a) = write_off_and_check(&ctx, &a);
        assert_eq!(after_a.senior_assets, before_a.senior_assets);
        assert!(after_a.junior_assets > 0);
        // B's loss (≈ €2,140.73) exhausts junior; senior takes the rest.
        let (_, before_b, after_b) = write_off_and_check(&ctx, &b);
        assert_eq!(after_b.junior_assets, 0);
        assert!(after_b.senior_assets < before_b.senior_assets);
        assert!(after_b.share_price_scaled < before_b.share_price_scaled);
        assert_eq!((after_b.total_debt, after_b.total_principal), (0, 0));
        // Without junior capital nothing can be lent (leverage cap).
        assert_eq!(after_b.leverage_headroom, 0);

        for id in 1..=3 {
            assert_eq!(ctx.notes.get(&id).status, NoteStatus::Cancelled);
        }
        assert_eq!(ctx.try_draw(&a, EUR), Error::AgentBlocked);
        assert_eq!(ctx.try_draw(&b, EUR), Error::AgentBlocked);
    }
}
