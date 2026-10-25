//! Agent A's two real notes interacting (spec §4.4 – §4.6, §5.4): draws take
//! the earliest escritura first, a cancellation is repaid from the card
//! balance at once, and a settlement repays carried debt first.

use advance_pool::{NoteCancelled, NoteSettled};
use advance_shared::{Error, NoteStatus};
use soroban_sdk::{testutils::Ledger as _, Event as _};

use crate::{fixture::NOTES, harness::*, worked_example::INDEX_DAY_90};

/// Agent A's half of fixture note 1 (note id 2): €9,416.25.
fn half_of_note_2() -> i128 {
    NOTES[1].agent_commission_cents as i128 * CENT
}

/// Credit limit of note 2: €4,708.125.
fn limit_of_note_2() -> i128 {
    half_of_note_2() / 2
}

e2e! {
    fn draws_take_the_earliest_escritura_first_and_cancel_uses_the_card_balance(code: Code) {
        let ctx = Ctx::deploy(code);
        let a = ctx.agent(0);
        assert_eq!(ctx.mint(0).value, 1); // escritura day + 90, limit €3,750
        assert_eq!(ctx.mint(1).value, 2); // escritura day + 60, limit €4,708.125
        ctx.enable_card(&a);

        // €4,000: all on note 2, whose escritura comes first.
        ctx.draw(&a, 4_000 * EUR);
        assert_eq!(ctx.pool.line(&2).line.principal, 4_000 * EUR);
        assert_eq!(ctx.pool.line(&1).line.principal, 0);
        // €1,000: note 2 up to its limit, the rest on note 1.
        let rest = 1_000 * EUR - (limit_of_note_2() - 4_000 * EUR); // €291.875
        ctx.draw(&a, 1_000 * EUR);
        assert_eq!(ctx.pool.line(&2).line.principal, limit_of_note_2());
        assert_eq!(ctx.pool.line(&2).available, 0);
        assert_eq!(ctx.pool.line(&1).line.principal, rest);
        let available = 3_750 * EUR - rest;
        assert_eq!(ctx.position(&a).available_credit, available);
        assert_eq!(ctx.try_draw(&a, available + 1), Error::InsufficientCredit);

        // Note 2's escritura, 60 days later (one accrual).
        ctx.advance_days(60);
        let index = accrue_index(SCALE, 60);
        let debt2 = mul_div_ceil(limit_of_note_2(), index, SCALE);
        let debt1 = mul_div_ceil(rest, index, SCALE);
        let payout = half_of_note_2() - debt2;
        let settle = ctx.settle(2);
        assert_eq!(
            ctx.emitted(&settle.events, &ctx.pool.address),
            [NoteSettled {
                note_id: 2,
                agent: a.clone(),
                total_commission: NOTES[1].total_commission_cents as i128 * CENT,
                debt_repaid: debt2,
                interest_paid: debt2 - limit_of_note_2(),
                carried_repaid: 0,
                agent_payout: payout,
                junior_deposit: half_of_note_2(),
            }
            .to_xdr(&ctx.env, &ctx.pool.address)]
        );
        assert_eq!(ctx.stats().borrow_index, index);
        assert_eq!(ctx.position(&a).card_balance, payout);

        // The buyer of note 1 walks away: its debt becomes carried debt and the
        // card balance repays it at once, so no grace period starts.
        let cancel = ctx.cancel(1);
        assert_eq!(
            ctx.emitted(&cancel.events, &ctx.pool.address),
            [NoteCancelled {
                note_id: 1,
                agent: a.clone(),
                debt_carried: debt1,
                grace_deadline: None,
            }
            .to_xdr(&ctx.env, &ctx.pool.address)]
        );
        let position = ctx.position(&a);
        assert_eq!(position.card_balance, payout - debt1);
        assert_eq!(position.carried_debt, 0);
        assert_eq!(position.grace_deadline, None);
        assert!(position.lines.is_empty());
        assert_eq!((ctx.stats().total_debt, ctx.stats().total_principal), (0, 0));
        assert_eq!(ctx.notes.get(&1).status, NoteStatus::Cancelled);
        assert_eq!(ctx.notes.get(&2).status, NoteStatus::Settled);

        // The card keeps working on the balance alone, then declines.
        let balance = payout - debt1;
        let spend = ctx.draw(&a, balance).value;
        assert_eq!((spend.from_balance, spend.from_credit), (balance, 0));
        assert_eq!(ctx.try_draw(&a, EUR), Error::InsufficientCredit);
    }
}

e2e! {
    fn a_settlement_repays_carried_debt_first(code: Code) {
        let ctx = Ctx::deploy(code);
        let a = ctx.agent(0);
        ctx.mint(0);
        ctx.mint(1);
        ctx.enable_card(&a);
        ctx.draw(&a, 4_000 * EUR); // on note 2 (earliest escritura)

        // Note 2 is cancelled at once: no card balance, so the grace period
        // starts and the carried debt eats into note 1's credit.
        let cancel = ctx.cancel(2);
        let deadline = start() + 180 * DAY;
        assert_eq!(
            ctx.emitted(&cancel.events, &ctx.pool.address),
            [NoteCancelled {
                note_id: 2,
                agent: a.clone(),
                debt_carried: 4_000 * EUR,
                grace_deadline: Some(deadline),
            }
            .to_xdr(&ctx.env, &ctx.pool.address)]
        );
        let position = ctx.position(&a);
        assert_eq!(position.carried_debt, 4_000 * EUR);
        assert_eq!(position.available_credit, 0); // €3,750 − €4,000 < 0
        assert_eq!(ctx.try_draw(&a, EUR), Error::InsufficientCredit);

        // Note 1's escritura, 90 days later: the agent's half repays the carried
        // debt (with its interest) before anything is paid out.
        ctx.advance_days(90);
        let carried = mul_div_ceil(4_000 * EUR, INDEX_DAY_90, SCALE);
        assert_eq!(ctx.position(&a).carried_debt, carried);
        let settle = ctx.settle(1);
        assert_eq!(
            ctx.emitted(&settle.events, &ctx.pool.address),
            [NoteSettled {
                note_id: 1,
                agent: a.clone(),
                total_commission: 15_000 * EUR,
                debt_repaid: 0,
                interest_paid: 0,
                carried_repaid: carried,
                agent_payout: 7_500 * EUR - carried,
                junior_deposit: 7_500 * EUR,
            }
            .to_xdr(&ctx.env, &ctx.pool.address)]
        );
        let position = ctx.position(&a);
        assert_eq!(position.carried_debt, 0);
        assert_eq!(position.grace_deadline, None);
        assert_eq!(position.card_balance, 7_500 * EUR - carried);
        assert!(!position.blocked);
        assert_eq!((ctx.stats().total_debt, ctx.stats().total_principal), (0, 0));
        assert_eq!(ctx.notes.get(&1).status, NoteStatus::Settled);
        assert_eq!(ctx.notes.get(&2).status, NoteStatus::Cancelled);
        // Nothing left to write off.
        assert_eq!(ctx.try_write_off(&a), Error::NothingToWriteOff);
    }
}

e2e! {
    /// Agent B's odd commission (€8,084.51) settles at its escritura: the
    /// agent's half is €4,042.25 and explorador's €4,042.26 (the extra cent)
    /// goes to the junior tranche.
    fn an_odd_commission_settles_with_the_extra_cent_to_explorador(code: Code) {
        let ctx = Ctx::deploy(code);
        let b = ctx.agent(2);
        assert_eq!(ctx.mint(2).value, 1);
        ctx.enable_card(&b);
        ctx.draw(&b, 1_000 * EUR);

        // The escritura, CPCV day + 75 (one accrual). This time real ledger
        // time passes instead of the demo fast-forward: the protocol clock
        // (ledger time + demo offset) follows it.
        ctx.env.ledger().set_timestamp(start() + 75 * DAY);
        assert_eq!(
            ctx.pool.protocol_now() / DAY,
            u64::from(NOTES[2].escritura_day)
        );
        let index = accrue_index(SCALE, 75);
        let debt = mul_div_ceil(1_000 * EUR, index, SCALE);
        let book_debt = 1_000 * EUR * index / SCALE; // the pool's total rounds down
        let (half, explorador) = (404_225 * CENT, 404_226 * CENT);
        let junior_before = ctx.stats().junior_assets;
        let treasury_before = ctx.balance(&ctx.treasury);

        let settle = ctx.settle(1);
        assert_eq!(
            ctx.emitted(&settle.events, &ctx.pool.address),
            [NoteSettled {
                note_id: 1,
                agent: b.clone(),
                total_commission: 808_451 * CENT,
                debt_repaid: debt,
                interest_paid: debt - 1_000 * EUR,
                carried_repaid: 0,
                agent_payout: half - debt,
                junior_deposit: explorador,
            }
            .to_xdr(&ctx.env, &ctx.pool.address)]
        );
        assert_eq!(
            ctx.balance(&ctx.treasury),
            treasury_before - 808_451 * CENT
        );
        assert_eq!(ctx.position(&b).card_balance, half - debt);
        // Junior: explorador's half plus the rounding surplus of the debt
        // (repaid rounded up, booked rounded down).
        assert_eq!(
            ctx.stats().junior_assets,
            junior_before + explorador + (debt - book_debt)
        );
        assert_eq!(ctx.notes.get(&1).status, NoteStatus::Settled);
    }
}
