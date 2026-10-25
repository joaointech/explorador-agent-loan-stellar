//! Spec §4.4 – §4.5 with the exact §5.6 numbers, on the real contracts: the
//! agent enables the card, spends €3,000 on day 0 against the €15,000 note
//! (fixture note 0, minted with its real proof), the escritura is 90 days
//! later with no other pool activity in between (a single accrual), and the
//! settlement repays debt + interest, credits the rest of the agent's half
//! to the card balance, grows the junior tranche and marks the note Settled
//! through the pool's `set_status` call.

use advance_pool::{CardDraw, CardEnabled, ClockAdvanced, DrawResult, LineStatus, NoteSettled};
use advance_shared::{Error, NoteStatus};
use cpcv_note::NoteStatusChanged;
use soroban_sdk::{testutils::Address as _, Address, Event as _};

use crate::{fixture::NOTES, harness::*};

/// Borrow index after one 90-day accrual at 12% APR:
/// `SCALE + SCALE × 1200 × 90 days / (BPS × YEAR)`.
pub const INDEX_DAY_90: i128 = 1_029_589_041_095_890_410;
/// €3,000 × (1 + 12% × 90/365), rounded up: €3,088.77.
pub const DEBT_DAY_90: i128 = 30_887_671_233;
/// €88.77 of interest.
pub const INTEREST_DAY_90: i128 = 887_671_233;
/// €7,500 − €3,088.77 = €4,411.23 to the card balance.
pub const PAYOUT: i128 = 44_112_328_767;
/// 10% of the pool's booked interest (887,671,232: the book debt rounds
/// down): €8.88.
pub const FEE: i128 = 88_767_123;
/// The rest of the interest, €79.89, all to senior (its 8% target on
/// €100,000 over 90 days is far above that).
pub const TO_SENIOR: i128 = 798_904_109;

/// Costs of the three transactions of the worked example.
pub struct Costs {
    pub mint: Cost,
    pub draw: Cost,
    pub settle: Cost,
}

/// Runs the §5.6 flow on a freshly deployed `ctx` and asserts its numbers to
/// the stroop. Leaves agent A with €0 of card balance and a €588.77 draw on
/// their second note (fixture note 1, note id 2).
pub fn run(ctx: &Ctx) -> Costs {
    let a = ctx.agent(0);
    let mint = ctx.mint(0);
    assert_eq!(mint.value, 1);

    // The operator can only draw after the agent's passkey consent.
    assert_eq!(ctx.try_draw(&a, 3_000 * EUR), Error::CardNotEnabled);
    let enabled = ctx.enable_card(&a);
    assert_eq!(
        ctx.emitted(&enabled.events, &ctx.pool.address),
        [CardEnabled {
            agent: a.clone(),
            enabled: true
        }
        .to_xdr(&ctx.env, &ctx.pool.address)]
    );
    assert!(ctx.position(&a).card_enabled);

    // Day 0: a €3,000 card purchase, all on credit (no card balance yet).
    let auth_ref = ctx.auth_ref();
    let draw = ctx.draw_with_ref(&a, 3_000 * EUR, &auth_ref);
    assert_eq!(
        draw.value,
        DrawResult {
            from_balance: 0,
            from_credit: 3_000 * EUR
        }
    );
    assert_eq!(
        ctx.event_names(&draw.events),
        ["teurc:transfer", "advance_pool:card_draw"]
    );
    assert_eq!(
        ctx.emitted(&draw.events, &ctx.pool.address),
        [CardDraw {
            agent: a.clone(),
            amount: 3_000 * EUR,
            from_balance: 0,
            from_credit: 3_000 * EUR,
            auth_ref: auth_ref.clone(),
        }
        .to_xdr(&ctx.env, &ctx.pool.address)]
    );
    assert_eq!(ctx.balance(&ctx.card_settlement), 3_000 * EUR);
    // The same card authorization is never funded twice.
    assert_eq!(
        ctx.try_draw_with_ref(&a, 3_000 * EUR, &auth_ref),
        Error::DuplicateDraw
    );
    // Credit limit €3,750: €750 left.
    let line = ctx.pool.line(&1);
    assert_eq!((line.debt, line.available), (3_000 * EUR, 750 * EUR));
    assert_eq!(ctx.try_draw(&a, 750 * EUR + 1), Error::InsufficientCredit);

    // A second note for agent A in the same ledger second: no time passes,
    // so the borrow index does not move and days 0–90 stay one accrual. Its
    // line (escritura day + 60) comes first in draw order but owes nothing.
    assert_eq!(ctx.mint(1).value, 2);
    assert_eq!(ctx.stats().borrow_index, SCALE);

    // The escritura, 90 days later on the demo clock.
    let advanced = ctx.advance_days(90);
    assert_eq!(
        ctx.emitted(&advanced.events, &ctx.pool.address),
        [ClockAdvanced {
            secs: 90 * DAY,
            protocol_now: start() + 90 * DAY,
        }
        .to_xdr(&ctx.env, &ctx.pool.address)]
    );
    assert_eq!(
        ctx.pool.protocol_now() / DAY,
        u64::from(NOTES[0].escritura_day)
    );
    // Views already include the 90 days of interest (non-mutating preview),
    // so investors see the share price up before the settlement.
    let preview = ctx.pool.line(&1);
    assert_eq!(
        (preview.debt, preview.interest),
        (DEBT_DAY_90, INTEREST_DAY_90)
    );
    let before = ctx.stats();
    assert_eq!(before.senior_assets, SENIOR_DEPOSIT + TO_SENIOR);
    assert!(before.share_price_scaled > SCALE);
    let treasury_before = ctx.balance(&ctx.treasury);

    // Confirm escritura: operator + treasury.
    let settle = ctx.settle(1);
    assert_eq!(
        ctx.event_names(&settle.events),
        [
            "teurc:transfer",
            "cpcv_note:note_status_changed",
            "advance_pool:note_settled"
        ]
    );
    assert_eq!(
        ctx.emitted(&settle.events, &ctx.pool.address),
        [NoteSettled {
            note_id: 1,
            agent: a.clone(),
            total_commission: 15_000 * EUR,
            debt_repaid: DEBT_DAY_90,
            interest_paid: INTEREST_DAY_90,
            carried_repaid: 0,
            agent_payout: PAYOUT,
            junior_deposit: 7_500 * EUR,
        }
        .to_xdr(&ctx.env, &ctx.pool.address)]
    );
    assert_eq!(
        ctx.emitted(&settle.events, &ctx.notes.address),
        [NoteStatusChanged {
            id: 1,
            status: NoteStatus::Settled
        }
        .to_xdr(&ctx.env, &ctx.notes.address)]
    );

    // §5.6, in euros (within €0.01) and to the stroop.
    let cents = |stroops: i128| (stroops + CENT / 2) / CENT;
    assert_eq!(cents(INTEREST_DAY_90), 8_877); // €88.77
    assert_eq!(cents(DEBT_DAY_90), 308_877); // €3,088.77
    assert_eq!(cents(PAYOUT), 441_123); // €4,411.23
    assert_eq!(cents(FEE), 888); // €8.88
    assert_eq!(cents(TO_SENIOR), 7_989); // €79.89
    assert_eq!(INDEX_DAY_90, accrue_index(SCALE, 90));
    let after = ctx.stats();
    assert_eq!(after.borrow_index, INDEX_DAY_90);
    assert_eq!(after.fees_accrued, FEE);
    assert_eq!(after.senior_assets, SENIOR_DEPOSIT + TO_SENIOR);
    // Junior: €10,000 seed + explorador's €7,500, plus the 1-stroop surplus
    // of rounding the agent's debt up (booked to junior by the pool).
    assert_eq!(after.junior_assets, JUNIOR_SEED + 7_500 * EUR + 1);
    assert_eq!((after.total_debt, after.total_principal), (0, 0));
    assert_eq!(after.total_card_balances, PAYOUT);
    assert_eq!(ctx.position(&a).card_balance, PAYOUT);
    assert_eq!(ctx.balance(&ctx.treasury), treasury_before - 15_000 * EUR);
    // Both contracts record the outcome.
    assert_eq!(ctx.notes.get(&1).status, NoteStatus::Settled);
    let line = ctx.pool.line(&1);
    assert_eq!(line.line.status, LineStatus::Settled);
    assert_eq!((line.debt, line.available), (0, 0));
    // Investors: settlement turned the accrued interest into cash, and the
    // share price stays up.
    assert_eq!(
        after.share_price_scaled,
        (after.senior_assets + 1) * SCALE / (after.share_supply + 1)
    );
    assert!(after.share_price_scaled > SCALE);
    assert!(ctx.pool.convert_to_assets(&SENIOR_DEPOSIT) > SENIOR_DEPOSIT);

    // Card spending order: card balance first, then credit, which now comes
    // from note 2 (the only active line).
    let spend = ctx.draw(&a, 5_000 * EUR);
    assert_eq!(
        spend.value,
        DrawResult {
            from_balance: PAYOUT,
            from_credit: 5_000 * EUR - PAYOUT,
        }
    );
    let position = ctx.position(&a);
    assert_eq!(position.card_balance, 0);
    assert_eq!(position.lines.len(), 1);
    let line2 = position.lines.get(0).unwrap();
    assert_eq!(line2.line.note_id, 2);
    assert_eq!(line2.line.principal, 5_000 * EUR - PAYOUT); // €588.77
    assert_eq!(ctx.balance(&ctx.card_settlement), 8_000 * EUR);

    Costs {
        mint: mint.cost,
        draw: draw.cost,
        settle: settle.cost,
    }
}

e2e! {
    fn card_draw_then_settle_reproduces_the_worked_example(code: Code) {
        let ctx = Ctx::deploy(code);
        let costs = run(&ctx);
        costs.mint.assert_fits_testnet("mint");
        costs.draw.assert_fits_testnet("card_draw");
        costs.settle.assert_fits_testnet("settle");
    }
}

e2e! {
    /// The rest of the lifecycle after the worked example: a second investor
    /// joins above par, the overdue second note settles, the agent withdraws
    /// their card balance, both investors redeem with yield, explorador
    /// claims its fees and takes out the junior tranche: the pool ends empty.
    fn lifecycle_continues_to_withdrawals_and_redemption(code: Code) {
        let ctx = Ctx::deploy(code);
        run(&ctx);
        let a = ctx.agent(0);
        let drawn = 5_000 * EUR - PAYOUT;

        // A second investor deposits €10,000 at the raised share price, so
        // gets fewer shares than stroops (SEP-56 math, rounded down).
        let investor2 = Address::generate(&ctx.env);
        ctx.step(|| ctx.token.faucet(&investor2, &(10_000 * EUR)));
        let s = ctx.stats();
        let expected = 10_000 * EUR * (s.share_supply + 1) / (s.senior_assets + 1);
        let shares2 = ctx.deposit(&investor2, 10_000 * EUR).value;
        assert_eq!(shares2, expected);
        assert!(shares2 < 10_000 * EUR);
        assert_eq!(ctx.pool.balance(&investor2), shares2);

        // Note 2's escritura (day 60) has passed: settlement has no date check
        // (the app shows "Overdue"). 30 more days of interest on €588.77.
        let scaled = mul_div_ceil(drawn, SCALE, INDEX_DAY_90);
        assert_eq!(ctx.pool.line(&2).line.scaled_debt, scaled);
        ctx.advance_days(30);
        let index = accrue_index(INDEX_DAY_90, 30);
        let debt = mul_div_ceil(scaled, index, SCALE);
        let half = NOTES[1].agent_commission_cents as i128 * CENT; // €9,416.25
        let junior_before = ctx.stats().junior_assets;

        let settle = ctx.settle(2);
        assert_eq!(
            ctx.emitted(&settle.events, &ctx.pool.address),
            [NoteSettled {
                note_id: 2,
                agent: a.clone(),
                total_commission: NOTES[1].total_commission_cents as i128 * CENT,
                debt_repaid: debt,
                interest_paid: debt - drawn,
                carried_repaid: 0,
                agent_payout: half - debt,
                junior_deposit: half,
            }
            .to_xdr(&ctx.env, &ctx.pool.address)]
        );
        let after = ctx.stats();
        assert_eq!(after.borrow_index, index);
        assert_eq!((after.total_debt, after.total_principal), (0, 0));
        // explorador's half, plus at most a stroop of rounding surplus.
        let junior_gain = after.junior_assets - junior_before;
        assert!(junior_gain == half || junior_gain == half + 1, "{junior_gain}");
        assert_eq!(ctx.notes.get(&2).status, NoteStatus::Settled);
        assert!(ctx.position(&a).lines.is_empty());

        // The agent withdraws the whole card balance to their smart account.
        let balance = ctx.position(&a).card_balance;
        assert_eq!(balance, half - debt);
        ctx.withdraw_balance(&a, balance, &a);
        assert_eq!(ctx.balance(&a), balance);
        assert_eq!(ctx.position(&a).card_balance, 0);

        // Both investors redeem everything, with the interest the agent paid.
        for (investor, deposited) in [
            (ctx.investor.clone(), SENIOR_DEPOSIT),
            (investor2.clone(), 10_000 * EUR),
        ] {
            let shares = ctx.pool.balance(&investor);
            assert_eq!(ctx.pool.max_redeem(&investor), shares);
            let preview = ctx.pool.preview_redeem(&shares);
            let redeemed = ctx.redeem(&investor, shares).value;
            assert_eq!(redeemed, preview);
            assert!(redeemed > deposited, "{redeemed} <= {deposited}");
            assert_eq!(ctx.balance(&investor), redeemed);
            assert_eq!(ctx.pool.balance(&investor), 0);
        }
        assert!(ctx.balance(&ctx.investor) > SENIOR_DEPOSIT + TO_SENIOR);

        // explorador claims the protocol fees...
        let fees = ctx.stats().fees_accrued;
        assert!(fees > FEE);
        let treasury_before = ctx.balance(&ctx.treasury);
        ctx.claim_fees(fees);
        assert_eq!(ctx.balance(&ctx.treasury), treasury_before + fees);
        // ...and, with no debt left, takes the whole junior tranche out.
        let junior = ctx.stats().junior_assets;
        ctx.junior_withdraw(junior);
        assert_eq!(ctx.balance(&ctx.treasury), treasury_before + fees + junior);

        // Every stroop is accounted for: only senior rounding dust is left.
        let end = ctx.stats();
        assert_eq!((end.fees_accrued, end.junior_assets, end.share_supply), (0, 0, 0));
        assert!(end.senior_assets <= 2, "{}", end.senior_assets);
        assert_eq!(ctx.balance(&ctx.pool.address), end.senior_assets);
    }
}
