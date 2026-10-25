//! Credit lines and card draws (spec §5.4, §7.3).

use advance_shared::Error;
use soroban_sdk::{testutils::Events as _, Event as _};

use super::*;
use crate::{CardDraw, LineOpened, LineStatus};

#[test]
fn open_line_from_the_note_contract() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);

    // Emitted inside cpcv_note.mint (the pool never calls back into the note).
    let events = ctx.e.events().all().filter_by_contract(&ctx.pool.address);
    assert_eq!(
        events.events().last().unwrap(),
        &LineOpened {
            note_id,
            agent: agent.clone(),
            credit_limit: 3_750 * EUR
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    let view = ctx.pool.line(&note_id);
    assert_eq!(
        view.line,
        crate::Line {
            note_id,
            agent: agent.clone(),
            credit_limit: 3_750 * EUR,
            principal: 0,
            scaled_debt: 0,
            escritura_day: ctx.today() + 90,
            status: LineStatus::Active,
        }
    );
    assert_eq!(
        (view.debt, view.interest, view.available),
        (0, 0, 3_750 * EUR)
    );
    let position = ctx.position(&agent);
    assert_eq!(position.available_credit, 3_750 * EUR);
    assert_eq!(position.borrowable_now, 3_750 * EUR);

    // A note can only open one line.
    assert_eq!(
        ctx.notes.try_reopen(&note_id),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::AlreadyInitialized as u32
        )))
    );
    assert_eq!(ctx.pool.try_line(&999), Err(Ok(Error::UnknownNote)));
}

#[test]
fn open_line_rejects_other_callers() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);
    let mut forged = ctx.notes.get(&note_id);
    forged.id = 77;

    // Without the note contract's authorization the call fails.
    ctx.e.set_auths(&[]);
    assert!(ctx.pool.try_open_line(&forged).is_err());
    ctx.e.mock_all_auths();
    assert_eq!(ctx.pool.try_line(&77), Err(Ok(Error::UnknownNote)));
}

#[test]
fn credit_limit_is_half_the_agent_commission() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let note_id = ctx.note(&agent, 15_000 * EUR, 90);

    assert_eq!(
        ctx.pool
            .try_card_draw(&agent, &(3_750 * EUR + 1), &ctx.auth_ref()),
        Err(Ok(Error::InsufficientCredit))
    );
    ctx.draw(&agent, 3_750 * EUR);
    let view = ctx.pool.line(&note_id);
    assert_eq!(view.debt, 3_750 * EUR);
    assert_eq!(view.available, 0);
    assert_eq!(ctx.position(&agent).available_credit, 0);
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &1, &ctx.auth_ref()),
        Err(Ok(Error::InsufficientCredit))
    );
    // Interest eats into the room of the line: still nothing available.
    ctx.advance_days(30);
    assert!(ctx.pool.line(&note_id).debt > 3_750 * EUR);
    assert_eq!(ctx.pool.line(&note_id).available, 0);
    ctx.assert_invariant();
}

#[test]
fn draws_spend_card_balance_first_then_earliest_escritura() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    // A settled note with no debt leaves €500 on the card balance.
    let paid = ctx.note(&agent, 1_000 * EUR, 10);
    ctx.pool.settle(&paid);
    assert_eq!(ctx.position(&agent).card_balance, 500 * EUR);

    // Minted late-escritura first: draw order must follow escritura, not id.
    let late = ctx.note(&agent, 8_000 * EUR, 200); // limit €2,000
    let early = ctx.note(&agent, 4_000 * EUR, 60); // limit €1,000
    let position = ctx.position(&agent);
    let order: std::vec::Vec<u32> = position.lines.iter().map(|v| v.line.note_id).collect();
    assert_eq!(order, std::vec![early, late]);
    assert_eq!(position.available_credit, 3_000 * EUR);

    // €2,000: €500 from the balance, then €1,000 (all of it) from the early
    // line, then €500 from the late one.
    let auth_ref = ctx.auth_ref();
    let result = ctx.pool.card_draw(&agent, &(2_000 * EUR), &auth_ref);
    assert_eq!(
        result,
        DrawResult {
            from_balance: 500 * EUR,
            from_credit: 1_500 * EUR
        }
    );
    let events = ctx.e.events().all().filter_by_contract(&ctx.pool.address);
    assert_eq!(
        events.events().last().unwrap(),
        &CardDraw {
            agent: agent.clone(),
            amount: 2_000 * EUR,
            from_balance: 500 * EUR,
            from_credit: 1_500 * EUR,
            auth_ref,
        }
        .to_xdr(&ctx.e, &ctx.pool.address)
    );
    assert_eq!(ctx.pool.line(&early).line.principal, 1_000 * EUR);
    assert_eq!(ctx.pool.line(&late).line.principal, 500 * EUR);
    let position = ctx.position(&agent);
    assert_eq!(position.card_balance, 0);
    assert_eq!(position.total_principal, 1_500 * EUR);
    assert_eq!(position.available_credit, 1_500 * EUR);
    assert_eq!(ctx.token.balance(&ctx.card_settlement), 2_000 * EUR);

    // The early line is full: the next draw comes from the late line.
    ctx.draw(&agent, 200 * EUR);
    assert_eq!(ctx.pool.line(&early).line.principal, 1_000 * EUR);
    assert_eq!(ctx.pool.line(&late).line.principal, 700 * EUR);
    ctx.assert_invariant();
}

#[test]
fn balance_only_draws_do_not_need_credit() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let paid = ctx.note(&agent, 1_000 * EUR, 10);
    ctx.pool.settle(&paid);
    let result = ctx.draw(&agent, 120 * EUR);
    assert_eq!(
        result,
        DrawResult {
            from_balance: 120 * EUR,
            from_credit: 0
        }
    );
    assert_eq!(ctx.position(&agent).card_balance, 380 * EUR);
    assert_eq!(ctx.stats().total_debt, 0);
    ctx.assert_invariant();
}

#[test]
fn leverage_cap_limits_total_debt() {
    // Junior €100 → total debt ≤ €1,000.
    let ctx = Ctx::bare(default_params());
    ctx.pool.junior_deposit(&(100 * EUR));
    ctx.investor(100_000 * EUR);
    let agent = ctx.agent();
    ctx.note(&agent, 15_000 * EUR, 90);
    let stats = ctx.stats();
    assert_eq!(stats.leverage_headroom, 1_000 * EUR);
    assert_eq!(ctx.position(&agent).borrowable_now, 1_000 * EUR);

    assert_eq!(
        ctx.pool
            .try_card_draw(&agent, &(1_000 * EUR + 1), &ctx.auth_ref()),
        Err(Ok(Error::LeverageCapExceeded))
    );
    ctx.draw(&agent, 1_000 * EUR);
    let stats = ctx.stats();
    assert_eq!(stats.leverage_headroom, 0);
    assert_eq!(stats.leverage_x100, 1_000);
    assert_eq!(ctx.position(&agent).borrowable_now, 0);
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &1, &ctx.auth_ref()),
        Err(Ok(Error::LeverageCapExceeded))
    );
    // The treasury cannot pull junior capital out from under the cap.
    assert_eq!(
        ctx.pool.try_junior_withdraw(&1),
        Err(Ok(Error::LeverageCapExceeded))
    );
    // More first-loss capital lifts the cap.
    ctx.pool.junior_deposit(&(100 * EUR));
    ctx.draw(&agent, 1_000 * EUR);
    ctx.assert_invariant();
}

#[test]
fn liquidity_caps_draws() {
    // No senior capital: only the €10,000 junior seed is lendable.
    let ctx = Ctx::new(default_params(), 0);
    let agent = ctx.agent();
    ctx.note(&agent, 100_000 * EUR, 90); // limit €25,000
    let stats = ctx.stats();
    assert_eq!(stats.lendable, 10_000 * EUR);
    assert_eq!(ctx.position(&agent).available_credit, 25_000 * EUR);
    assert_eq!(ctx.position(&agent).borrowable_now, 10_000 * EUR);

    assert_eq!(
        ctx.pool
            .try_card_draw(&agent, &(10_000 * EUR + 1), &ctx.auth_ref()),
        Err(Ok(Error::InsufficientLiquidity))
    );
    ctx.draw(&agent, 10_000 * EUR);
    assert_eq!(ctx.stats().lendable, 0);
    assert_eq!(ctx.stats().utilization_bps, 10_000);
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &1, &ctx.auth_ref()),
        Err(Ok(Error::InsufficientLiquidity))
    );

    // Accrued fees are reserved: they are not lendable.
    ctx.investor(1_000 * EUR);
    ctx.advance_days(365);
    let stats = ctx.stats();
    assert!(stats.fees_accrued > 0);
    assert_eq!(stats.lendable, stats.pool_cash - stats.fees_accrued);
    ctx.assert_invariant();
}

#[test]
fn blocked_agents_get_no_credit() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let paid = ctx.note(&agent, 1_000 * EUR, 10);
    ctx.pool.settle(&paid);
    ctx.note(&agent, 15_000 * EUR, 90);

    ctx.pool.set_blocked(&agent, &true);
    assert_eq!(ctx.e.auths()[0].0, ctx.operator);
    let position = ctx.position(&agent);
    assert!(position.blocked);
    assert_eq!(position.available_credit, 0);
    assert_eq!(position.borrowable_now, 0);
    assert_eq!(
        ctx.pool
            .try_card_draw(&agent, &(600 * EUR), &ctx.auth_ref()),
        Err(Ok(Error::AgentBlocked))
    );
    // The agent's own card balance stays spendable.
    ctx.draw(&agent, 500 * EUR);

    ctx.pool.set_blocked(&agent, &false);
    assert_eq!(ctx.position(&agent).available_credit, 3_750 * EUR);
    ctx.draw(&agent, 100 * EUR);
    ctx.assert_invariant();
}

#[test]
fn duplicate_auth_ref_is_rejected() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    ctx.note(&agent, 15_000 * EUR, 90);

    let auth_ref = ctx.auth_ref();
    ctx.pool.card_draw(&agent, &(100 * EUR), &auth_ref);
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &(100 * EUR), &auth_ref),
        Err(Ok(Error::DuplicateDraw))
    );
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &(5 * EUR), &auth_ref),
        Err(Ok(Error::DuplicateDraw))
    );
    assert_eq!(ctx.position(&agent).total_principal, 100 * EUR);

    // A failed draw does not burn its reference.
    let retry = ctx.auth_ref();
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &(9_999 * EUR), &retry),
        Err(Ok(Error::InsufficientCredit))
    );
    ctx.pool.card_draw(&agent, &(50 * EUR), &retry);
    assert_eq!(ctx.position(&agent).total_principal, 150 * EUR);
}

#[test]
fn card_must_be_enabled_by_the_agent() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = Address::generate(&ctx.e);
    ctx.note(&agent, 15_000 * EUR, 90);
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &EUR, &ctx.auth_ref()),
        Err(Ok(Error::CardNotEnabled))
    );

    ctx.pool.enable_card(&agent);
    let auths = ctx.e.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, agent);
    assert!(ctx.position(&agent).card_enabled);
    ctx.draw(&agent, EUR);

    ctx.pool.disable_card(&agent);
    assert_eq!(ctx.e.auths()[0].0, agent);
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &EUR, &ctx.auth_ref()),
        Err(Ok(Error::CardNotEnabled))
    );
}

#[test]
fn card_draw_is_operator_only() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    ctx.note(&agent, 15_000 * EUR, 90);
    ctx.draw(&agent, EUR);
    let auths = ctx.e.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, ctx.operator);

    ctx.e.set_auths(&[]);
    assert!(ctx
        .pool
        .try_card_draw(&agent, &EUR, &ctx.auth_ref())
        .is_err());
    ctx.e.mock_all_auths();
    assert_eq!(
        ctx.pool.try_card_draw(&agent, &0, &ctx.auth_ref()),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn agents_withdraw_their_card_balance() {
    let ctx = Ctx::new(default_params(), 100_000 * EUR);
    let agent = ctx.agent();
    let paid = ctx.note(&agent, 1_000 * EUR, 10);
    ctx.pool.settle(&paid);
    let wallet = Address::generate(&ctx.e);

    assert_eq!(
        ctx.pool.try_withdraw_balance(&agent, &(501 * EUR), &wallet),
        Err(Ok(Error::InvalidAmount))
    );
    ctx.pool.withdraw_balance(&agent, &(200 * EUR), &wallet);
    let auths = ctx.e.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, agent);
    assert_eq!(ctx.token.balance(&wallet), 200 * EUR);
    assert_eq!(ctx.position(&agent).card_balance, 300 * EUR);
    assert_eq!(ctx.stats().total_card_balances, 300 * EUR);
    ctx.assert_invariant();
}
