//! Spec §4.3 through the real path: the operator calls `cpcv_note.mint` with a
//! real snarkjs proof, the note contract verifies it on-chain (BN254 host
//! functions), mints the soulbound note to the agent bound in the proof and
//! calls the real `advance_pool.open_line(note)`.

use std::vec::Vec as StdVec;

use advance_pool::{Line, LineOpened, LineStatus, LineView};
use advance_shared::{Error, Note, NoteStatus};
use cpcv_note::NoteMinted;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Event as _, String};

use crate::{fixture::NOTES, harness::*};

e2e! {
    fn mint_verifies_the_proof_on_chain_and_opens_the_credit_line(code: Code) {
        let ctx = Ctx::deploy(code);
        let n = &NOTES[0]; // the §5.6 deal: €15,000 total commission
        let agent = ctx.agent(0);
        assert_eq!(ctx.notes.count(), 0);

        // Signed by the operator alone (`Ctx::signed` checks that this was the
        // only authorization required): the pool's `open_line` accepted the note
        // contract's invoker auth.
        let out = ctx.mint(0);
        assert_eq!(out.value, 1);

        // The note: amounts in stroops, minted at the pool's protocol time.
        let note = ctx.notes.get(&1);
        assert_eq!(
            note,
            Note {
                id: 1,
                agent: agent.clone(),
                total_commission: 15_000 * EUR,
                agent_commission: 7_500 * EUR,
                explorador_commission: 7_500 * EUR,
                escritura_day: n.escritura_day,
                commitment: bytes32(&ctx.env, &n.commitment),
                nullifier: bytes32(&ctx.env, &n.nullifier),
                proof: proof(&ctx.env, n),
                minted_at: start(),
                status: NoteStatus::Active,
            }
        );
        assert_eq!(note.minted_at, ctx.pool.protocol_now());

        // Public registry.
        assert_eq!(ctx.notes.count(), 1);
        assert_eq!(ctx.notes.list(&0, &50), soroban_sdk::vec![&ctx.env, note.clone()]);
        assert_eq!(ctx.notes.notes_of(&agent), soroban_sdk::vec![&ctx.env, 1u32]);
        assert!(ctx.notes.nullifier_used(&bytes32(&ctx.env, &n.nullifier)));
        assert!(!ctx.notes.nullifier_used(&bytes32(&ctx.env, &NOTES[1].nullifier)));
        // SEP-50: minted to the agent bound in the proof.
        assert_eq!(ctx.notes.owner_of(&1), agent);
        assert_eq!(ctx.notes.balance(&agent), 1);
        assert_eq!(
            ctx.notes.token_uri(&1),
            String::from_str(&ctx.env, "https://advance.explorador.ai/api/registry/1")
        );

        // The real pool opened the line: credit limit = agent commission × 50%.
        let view = ctx.pool.line(&1);
        assert_eq!(
            view,
            LineView {
                line: Line {
                    note_id: 1,
                    agent: agent.clone(),
                    credit_limit: 3_750 * EUR,
                    principal: 0,
                    scaled_debt: 0,
                    escritura_day: n.escritura_day,
                    status: LineStatus::Active,
                },
                debt: 0,
                interest: 0,
                available: 3_750 * EUR,
            }
        );
        let position = ctx.position(&agent);
        assert_eq!(position.lines, soroban_sdk::vec![&ctx.env, view]);
        assert_eq!(position.available_credit, 3_750 * EUR);
        assert_eq!(position.borrowable_now, 3_750 * EUR);
        assert!(!position.card_enabled);
        assert_eq!(position.card_balance, 0);

        // Events: the pool's `line_opened` is emitted inside the note contract's
        // mint, after OpenZeppelin's `mint` and before `note_minted`.
        assert_eq!(
            ctx.event_names(&out.events),
            [
                "cpcv_note:mint",
                "advance_pool:line_opened",
                "cpcv_note:note_minted"
            ]
        );
        assert_eq!(
            ctx.emitted(&out.events, &ctx.pool.address),
            [LineOpened {
                note_id: 1,
                agent: agent.clone(),
                credit_limit: 3_750 * EUR,
            }
            .to_xdr(&ctx.env, &ctx.pool.address)]
        );
        assert_eq!(
            ctx.emitted(&out.events, &ctx.notes.address).last(),
            Some(
                &NoteMinted {
                    id: 1,
                    agent,
                    total_commission: 15_000 * EUR,
                    agent_commission: 7_500 * EUR,
                    escritura_day: n.escritura_day,
                    commitment: bytes32(&ctx.env, &n.commitment),
                    nullifier: bytes32(&ctx.env, &n.nullifier),
                }
                .to_xdr(&ctx.env, &ctx.notes.address)
            )
        );

        // Cost of the whole mint transaction: proof verification, registry
        // writes, NFT mint and the cross-contract open_line. Natively only the
        // host functions are metered; on the wasm, everything.
        let what = std::format!(
            "cpcv_note.mint + advance_pool.open_line ({})",
            code.label()
        );
        std::println!("{}", out.cost.report(&what));
        out.cost.assert_fits_testnet(&what);
        // The BN254 pairing check alone is ~35M instructions (DECISIONS.md),
        // still under a tenth of the 400M per-transaction limit.
        assert!(out.cost.instructions > 30_000_000);
        assert!(out.cost.instructions < limits::TX_MAX_INSTRUCTIONS / 10);
    }
}

e2e! {
    fn mint_rejects_what_the_proof_does_not_bind(code: Code) {
        let ctx = Ctx::deploy(code);
        let (a, b) = (ctx.agent(0), ctx.agent(2));

        // The proof binds agent A's agent_field: minting it to anyone else fails
        // the on-chain verification, and nothing reaches the pool.
        assert_eq!(ctx.try_mint_as(0, &b), Err(Error::InvalidProof));
        assert_eq!(
            ctx.try_mint_as(0, &Address::generate(&ctx.env)),
            Err(Error::InvalidProof)
        );
        assert_eq!(ctx.notes.count(), 0);
        assert_eq!(
            contract_error(ctx.pool.try_line(&1)),
            Error::UnknownNote
        );

        assert_eq!(ctx.mint(0).value, 1);

        // One note per deal: the same nullifier is rejected...
        assert_eq!(ctx.try_mint_as(0, &a), Err(Error::NullifierUsed));
        // ...and so is the same commitment under a fresh nullifier (checked
        // before the proof).
        let n = &NOTES[0];
        let mut args = ctx.mint_args(0, &a);
        args.5 = BytesN::from_array(&ctx.env, &[7u8; 32]);
        ctx.authorize(&[sig(
            &ctx.operator,
            Call::new(&ctx.notes.address, "mint", args.clone()),
        )]);
        let res = ctx
            .step(|| {
                contract_error(
                    ctx.notes
                        .try_mint(&args.0, &args.1, &args.2, &args.3, &args.4, &args.5),
                )
            })
            .value;
        assert_eq!(res, Error::CommitmentUsed);
        assert_eq!(ctx.notes.count(), 1);
        assert_eq!(contract_error(ctx.pool.try_line(&2)), Error::UnknownNote);
        assert_eq!(ctx.position(&a).lines.len(), 1);
        assert_eq!(ctx.notes.get(&1).nullifier, bytes32(&ctx.env, &n.nullifier));

        // The escritura check reads the pool's protocol clock, demo offset
        // included: 75 days on, fixture note 2's escritura is "today".
        ctx.advance_days(75);
        assert_eq!(ctx.pool.protocol_now() / DAY, u64::from(NOTES[2].escritura_day));
        assert_eq!(ctx.try_mint_as(2, &b), Err(Error::EscrituraInPast));
        assert_eq!(ctx.notes.count(), 1);
    }
}

e2e! {
    fn only_the_right_contracts_and_roles_can_act(code: Code) {
        let ctx = Ctx::deploy(code);
        let a = ctx.agent(0);

        // Minting needs the operator: the admin's signature is not enough (the
        // host rejects the missing authorization; no contract error).
        let args = ctx.mint_args(0, &a);
        ctx.authorize(&[sig(
            &ctx.admin,
            Call::new(&ctx.notes.address, "mint", args.clone()),
        )]);
        let res = ctx
            .step(|| {
                ctx.notes
                    .try_mint(&args.0, &args.1, &args.2, &args.3, &args.4, &args.5)
            })
            .value;
        assert!(matches!(res, Err(Err(_))), "{res:?}");
        assert_eq!(ctx.notes.count(), 0);

        assert_eq!(ctx.mint(0).value, 1);
        let note = ctx.notes.get(&1);

        // Only cpcv_note (as the direct invoker during mint) can open a line:
        // nobody can forge a note, not even with the operator's signature.
        let mut forged = note.clone();
        forged.id = 99;
        for signers in [StdVec::new(), std::vec![ctx.operator.clone()]] {
            let sigs: StdVec<Sig> = signers
                .iter()
                .map(|s| {
                    sig(
                        s,
                        Call::new(&ctx.pool.address, "open_line", (forged.clone(),)),
                    )
                })
                .collect();
            ctx.authorize(&sigs);
            let res = ctx.step(|| ctx.pool.try_open_line(&forged)).value;
            assert!(matches!(res, Err(Err(_))), "{res:?}");
        }
        assert_eq!(contract_error(ctx.pool.try_line(&99)), Error::UnknownNote);

        // Only the pool (as the direct invoker during settle/cancel) can change
        // a note's status: the operator and the admin cannot.
        for signer in [&ctx.operator, &ctx.admin] {
            ctx.authorize(&[sig(
                signer,
                Call::new(
                    &ctx.notes.address,
                    "set_status",
                    (1u32, NoteStatus::Settled),
                ),
            )]);
            let res = ctx
                .step(|| ctx.notes.try_set_status(&1, &NoteStatus::Settled))
                .value;
            assert!(matches!(res, Err(Err(_))), "{res:?}");
        }
        assert_eq!(ctx.notes.get(&1).status, NoteStatus::Active);

        // The pool settles only with the treasury's signature too.
        ctx.enable_card(&a);
        ctx.draw(&a, 100 * EUR);
        ctx.authorize(&[sig(
            &ctx.operator,
            Call::new(&ctx.pool.address, "settle", (1u32,)),
        )]);
        let res = ctx.step(|| ctx.pool.try_settle(&1)).value;
        assert!(matches!(res, Err(Err(_))), "{res:?}");
        assert_eq!(ctx.pool.line(&1).line.status, LineStatus::Active);
        assert_eq!(ctx.notes.get(&1).status, NoteStatus::Active);
    }
}

e2e! {
    fn notes_are_soulbound(code: Code) {
        let ctx = Ctx::deploy(code);
        let id = ctx.mint(0).value;
        let owner = ctx.agent(0);
        let other = Address::generate(&ctx.env);
        let soulbound = soroban_sdk::Error::from_contract_error(Error::Soulbound as u32);

        // Even with the owner's own signature, every transfer and approval
        // fails with Error::Soulbound.
        let owner_signs = |func: &'static str, args: soroban_sdk::Vec<soroban_sdk::Val>| {
            ctx.authorize(&[sig(&owner, Call::new(&ctx.notes.address, func, args))]);
        };
        use soroban_sdk::IntoVal;
        owner_signs("transfer", (owner.clone(), other.clone(), id).into_val(&ctx.env));
        assert_eq!(
            ctx.step(|| ctx.notes.try_transfer(&owner, &other, &id)).value,
            Err(Ok(soulbound))
        );
        owner_signs(
            "transfer_from",
            (owner.clone(), owner.clone(), other.clone(), id).into_val(&ctx.env),
        );
        assert_eq!(
            ctx.step(|| ctx.notes.try_transfer_from(&owner, &owner, &other, &id))
                .value,
            Err(Ok(soulbound))
        );
        owner_signs(
            "approve",
            (owner.clone(), other.clone(), id, 1_000u32).into_val(&ctx.env),
        );
        assert_eq!(
            ctx.step(|| ctx.notes.try_approve(&owner, &other, &id, &1_000))
                .value,
            Err(Ok(soulbound))
        );
        owner_signs(
            "approve_for_all",
            (owner.clone(), other.clone(), 1_000u32).into_val(&ctx.env),
        );
        assert_eq!(
            ctx.step(|| ctx.notes.try_approve_for_all(&owner, &other, &1_000))
                .value,
            Err(Ok(soulbound))
        );

        assert_eq!(ctx.notes.owner_of(&id), owner);
        assert_eq!(ctx.notes.balance(&owner), 1);
        assert_eq!(ctx.notes.balance(&other), 0);
        assert_eq!(ctx.notes.get_approved(&id), None);
        assert!(!ctx.notes.is_approved_for_all(&owner, &other));
        // The credit line stays with the agent.
        assert_eq!(ctx.pool.line(&id).line.agent, owner);
    }
}

e2e! {
    fn registry_and_lines_for_all_three_fixture_notes(code: Code) {
        let ctx = Ctx::deploy(code);
        let (a, b) = (ctx.agent(0), ctx.agent(2));
        assert_eq!(ctx.mint(0).value, 1);
        assert_eq!(ctx.mint(1).value, 2);
        assert_eq!(ctx.mint(2).value, 3);

        assert_eq!(ctx.notes.count(), 3);
        let ids = |notes: soroban_sdk::Vec<Note>| -> StdVec<u32> {
            notes.iter().map(|n| n.id).collect()
        };
        assert_eq!(ids(ctx.notes.list(&0, &50)), [1, 2, 3]);
        assert_eq!(ids(ctx.notes.list(&2, &1)), [2]);
        assert_eq!(ids(ctx.notes.list(&3, &10)), [3]);
        assert_eq!(ctx.notes.notes_of(&a), soroban_sdk::vec![&ctx.env, 1u32, 2]);
        assert_eq!(ctx.notes.notes_of(&b), soroban_sdk::vec![&ctx.env, 3u32]);
        assert_eq!(ctx.notes.balance(&a), 2);
        assert_eq!(ctx.notes.balance(&b), 1);

        // Agent A's lines, in draw order: note 2 (escritura day + 60) before
        // note 1 (day + 90). Credit limits are half the agent's commission.
        let pa = ctx.position(&a);
        let lines: StdVec<(u32, i128)> = pa
            .lines
            .iter()
            .map(|v| (v.line.note_id, v.line.credit_limit))
            .collect();
        assert_eq!(lines, [(2, 47_081_250_000), (1, 3_750 * EUR)]);
        assert_eq!(pa.available_credit, 47_081_250_000 + 3_750 * EUR);

        // Agent B's odd commission: €8,084.51 → agent €4,042.25, explorador
        // €4,042.26; credit limit €2,021.125.
        let odd = ctx.notes.get(&3);
        assert_eq!(odd.total_commission, 808_451 * CENT);
        assert_eq!(odd.agent_commission, 404_225 * CENT);
        assert_eq!(odd.explorador_commission, 404_226 * CENT);
        let pb = ctx.position(&b);
        assert_eq!(pb.lines.len(), 1);
        assert_eq!(pb.lines.get(0).unwrap().line.credit_limit, 20_211_250_000);
        assert_eq!(pb.available_credit, 20_211_250_000);
    }
}
