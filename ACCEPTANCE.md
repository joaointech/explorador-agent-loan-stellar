# Acceptance checklist

This is the spec §12.2 acceptance checklist, with the status and evidence for each item. It was written on 25 Oct 2026 against `feat/explorador-advance` at `2cd9136`, which includes the testnet deploy, seed and e2e, the landing and registry pages, and the security-review fixes.

Status legend:

- **Verified**: shown by automated tests and/or transactions on Stellar testnet, cited below.
- **Verified (automated) · browser QA pending**: the behaviour is proven by tests or testnet runs, but the UI path still needs a person to click through it.
- **Pending**: not yet demonstrable on this branch.

| # | Item | Status |
|---|---|---|
| 1 | A fresh clone builds with the README steps. | **Partly verified**: install, contract build, every test suite, typecheck, lint and `next build` pass on a clean checkout. The keys → deploy → seed path was not re-run for this document. |
| 2 | Contracts deployed on testnet; ids in `deployments/testnet.json`. | **Verified** |
| 3 | Admin can create a CPCV and see a note minted with a real on-chain Groth16 verification (tx link). | **Verified (automated) · browser QA pending** |
| 4 | The registry shows the note with no personal data, and "Verify proof in your browser" succeeds. | **Verified (automated) · browser QA pending** |
| 5 | A new agent signs up with email + passkey, never sees a wallet, gets a card and activates it with one passkey prompt. | **Verified (automated) · browser QA pending** (real WebAuthn ceremony) |
| 6 | A simulated Lithic purchase is approved via ASA and a `CardDraw` appears on-chain within ~10 s. | **Verified** on testnet with the in-app simulated card network (8.5 s); not run against a real Lithic sandbox key |
| 7 | A purchase larger than spendable is declined with `INSUFFICIENT_FUNDS`. | **Verified** |
| 8 | Investors can deposit/withdraw with Freighter and see projected/trailing APY and pool health. | **Verified (automated)** on testnet with a keypair standing in for Freighter · **browser QA pending** (Freighter extension, charts) |
| 9 | Settling repays debt + interest, credits the agent's card balance and grows the junior tranche; share price rises. | **Verified** |
| 10 | Cancelling moves debt to carried; write-off after the grace period reduces junior first. | **Verified** |
| 11 | The design is recognisably explorador.pt (Sora, blue nav bar, two-tone headlines, rounded white cards), in light and dark mode, and works at phone width. | **Pending browser QA** |
| 12 | "Reset demo" restores the seeded state. | **Verified** through `pnpm demo:reset` (same code as the button) · **browser QA pending** for the admin button |

All transaction links are `https://stellar.expert/explorer/testnet/tx/<hash>`. Every hash cited here was re-read from the testnet RPC on 25 Oct 2026, either as a `SUCCESS` from `getTransaction` or as an event from `getEvents`.

---

## 1. A fresh clone builds with the README steps

These were run on a clean checkout of this branch: no `apps/web/.env.local`, no build caches.

| Step | Result |
|---|---|
| `pnpm install` | OK; the Prisma client is generated on `postinstall` |
| `pnpm contracts:build` | OK; teurc 10,539 B, cpcv_note 23,268 B, advance_pool 56,555 B. **The wasm hashes equal the ones in `deployments/testnet.json`** (`761716af…`, `a52f94d1…`, `299d6e9f…`), so the deployed code is this source. |
| `pnpm contracts:test` | 99 passed, 16 ignored (wasm-only) |
| `cd contracts && cargo test --workspace -- --ignored` | 16 passed |
| `pnpm --filter web test` | 73 files / 724 tests passed; database-backed files skipped |
| same with `TEST_DATABASE_URL` (fresh database, `prisma db push`) | 80 files / 797 tests passed, 1 skipped (the opt-in testnet investor test) |
| `pnpm circuits:test` | 21 passed |
| `pnpm typecheck`, `pnpm lint` | clean |
| `pnpm build` | OK without any env vars: every page (including `/registry` and `/registry/[id]`) and API route, plus the proxy |

**Not re-run for this document:** `pnpm keys:generate` → `pnpm db:migrate` → `pnpm deploy:testnet` → `pnpm seed` → `pnpm dev` from a fresh clone. Those steps spend testnet XLM and create new contracts. The same scripts produced the live deployment (item 2) and the e2e run (appendix B). `keys:generate` was exercised offline against the completed `apps/web/.env.example`: every key and secret was generated, the placeholder admin was replaced by `admin@demo.explorador.pt`, and all 28 template keys parse identically with Node's `loadEnvFile` parser, `dotenv` and the repo's own `parseEnvFile`. **The orchestrator should still do one full clean-machine pass.**

## 2. Contracts deployed on testnet

`deployments/testnet.json` (deployed 2026-10-25T17:31:27Z, `demoMode: true`):

| Contract | Id | Deploy tx |
|---|---|---|
| teurc | [`CALF4P2BE6RO5NH4N4W5MG7TUAR4VFEBTQ2EIWRPQHTB3K5NGWFWJYEO`](https://stellar.expert/explorer/testnet/contract/CALF4P2BE6RO5NH4N4W5MG7TUAR4VFEBTQ2EIWRPQHTB3K5NGWFWJYEO) | [`134ea937…`](https://stellar.expert/explorer/testnet/tx/134ea937c98023702b8ad6b28fd775e0f96815661071838122cf0476f17c38d3) |
| cpcv_note | [`CB4L4OXWRN5NWQSIZXYS6XWKZ4GEUJAJXRINATC6W2SOSCMUI44L2JDY`](https://stellar.expert/explorer/testnet/contract/CB4L4OXWRN5NWQSIZXYS6XWKZ4GEUJAJXRINATC6W2SOSCMUI44L2JDY) | [`c2690ab6…`](https://stellar.expert/explorer/testnet/tx/c2690ab6ff305f994bcbe72248bf8df258003f6fe4a3106a0644f3f63f2542d0) |
| advance_pool | [`CAXL6SAKTREO7QOEHIRGTPHHL34MUNGXK5RN4PS3TKMGFWF4ZSXWV3Q5`](https://stellar.expert/explorer/testnet/contract/CAXL6SAKTREO7QOEHIRGTPHHL34MUNGXK5RN4PS3TKMGFWF4ZSXWV3Q5) | [`6927ab54…`](https://stellar.expert/explorer/testnet/tx/6927ab5492772ca40d93978c364646c18a1b5432a6ce99cf5bad714e9d529843) |

The wiring follows spec §7.4: `cpcv_note.set_pool` [`3f6ae40e…`](https://stellar.expert/explorer/testnet/tx/3f6ae40e902fe83ae527f350cf491592a66f7c70c0b61c49421d37c0bc6b2283), 1,000,000 tEURC to the treasury [`17705fec…`](https://stellar.expert/explorer/testnet/tx/17705fec158e58b67e395507f09473489d5da669781765be59822e0cfb623876), and `junior_deposit(10,000)` [`61cce0ae…`](https://stellar.expert/explorer/testnet/tx/61cce0aed31688f073018938b2e468261ba5f20fe6569186e4db1237601f7fac). Code and instances were pre-extended to 90 days, until about 23 Jan 2027 (DECISIONS.md, "Code TTL hazard").

Live reads at 17:50 UTC (RPC simulation, no keys): `cpcv_note.count()` = 5. `advance_pool.stats()`: senior €65,198.64, junior €29,420.00, fees €22.07, total debt €6,168.79, pool cash €88,471.92, card balances €17,006.58, 65,000 eaSR at share price 1.003056, utilization 6.51%, leverage 0.20×, `protocol_now` 22 Feb 2027 (= ledger time + 120 days), `params` as spec §5.1 (1200 / 1000 / 800 / 5000 bps, 180-day grace, 10× leverage, demo mode).

## 3. Admin creates a CPCV; the note is minted with on-chain Groth16 verification

- **The pipeline on testnet.** All five seeded CPCVs went through the admin's own New CPCV pipeline: `lib/demo/cpcv.ts` → `adminCpcvInputSchema` + `runCpcvPipeline`, the code behind `POST /api/admin/cpcv`. Each one ran validate → sign the attestation → prove → verify locally → `cpcv_note.mint`, which verified the proof on-chain:

  | Note | Mint tx |
  |---|---|
  | #1 | [`b41bc9c1…`](https://stellar.expert/explorer/testnet/tx/b41bc9c1f5811ebc00957de8f770073ba523d4a715993ab7a4a851f3ee9d91b8) |
  | #2 | [`54d4766c…`](https://stellar.expert/explorer/testnet/tx/54d4766c1c3e98ec66afb14e746021607c88bce0e998a5e5deb0065af48e76c1) |
  | #3 | [`4c97218d…`](https://stellar.expert/explorer/testnet/tx/4c97218d15418295ac0073bfa50c41f3670545fcf1684af6a1dd656fde769c1f) |
  | #4 | [`0b58d87e…`](https://stellar.expert/explorer/testnet/tx/0b58d87e04901c2d569df22a499b88f19584405e8023332275319485a8212a07) |
  | #5 | [`26ad9d00…`](https://stellar.expert/explorer/testnet/tx/26ad9d002437a53353414557527f3fb9bf450b3a731ffb357ab7794aca882b69) |

- **e2e.** In the e2e run, "mint note 1 (on-chain Groth16)" is [`eadd96db…`](https://stellar.expert/explorer/testnet/tx/eadd96db6b853aa7697cde60f9b15e8915eae7f7b70846fe374757d2c3b01598), with checks "note #1 stores total €15,000 / agent €7,500" and "credit line = 50% of the agent commission (€3,750)".
- **Contract tests.** `shared`: `verifies_the_snarkjs_fixture_proofs`, `rejects_a_tampered_public_input`, `rejects_a_tampered_proof`, `rejects_non_canonical_public_inputs`, `fixture_matches_the_committed_deploy_verification_key`. `cpcv_note`: `mint_happy_path`, `rejects_a_duplicate_nullifier`, `rejects_a_duplicate_commitment`, `rejects_a_proof_signed_for_another_attester_key`, `rejects_a_wrong_nullifier_secret_commitment`, `rejects_an_escritura_in_the_past`, `rejects_minting_to_an_address_other_than_the_proven_agent`, `notes_are_soulbound`. `integration_tests`: `mint::mint_verifies_the_proof_on_chain_and_opens_the_credit_line` (native and optimized wasm).
- **Cost.** A full mint with the real pool uses 39.0M CPU instructions, 9.8% of testnet's 400M per-transaction limit (DECISIONS.md).
- **Web tests.** `lib/admin/pipeline.db.test.ts`, `lib/admin/pipeline.prove.db.test.ts` (a real proof), `lib/admin/sse.test.ts`, `lib/admin/cpcv-input.test.ts`.
- **Browser QA pending:** the New CPCV form with its live split preview, the SSE stepper, and the tx link.

## 4. Registry without personal data; "Verify proof in your browser"

- **Pages.** `/registry` has status counts, a filter, search and "Load more". `/registry/[id]` shows the public fields, commitment, nullifier, proof points, the 9 public signals, the events timeline and what is hidden.
- **Public API.** `GET /api/registry`, `GET /api/registry/[id]` and the SEP-50 metadata (`/api/registry/[id]/metadata`, alias `/api/notes/[id]`) select public columns only. Tests in `app/api/routes.test.ts`: "returns public fields, the stored snarkjs proof + signals, draws and a timeline — and no PII" and "returns SEP-50 metadata without personal data". Also `lib/indexer/read-models.test.ts`.
- **"Verify proof in your browser" reads Stellar, not the API.** It simulates `cpcv_note.get(id)`, `attester_params()` and `verification_key()` on the Soroban RPC from the browser. It requires the registry's copy and the published verification key to equal the contract's, rebuilds the public signals and runs `snarkjs.groth16.verify` (DECISIONS.md, "Web: landing and registry pages").
- **Tests.**
  - `components/registry/proof-check.test.ts`: "verifies from Stellar alone when the registry has no signals or snarkjs proof", "fails when the registry's copy differs from the note on Stellar", "fails when the published verification key isn't the contract's", "rejects a proof made under another attester key, even with consistent bytes and signals".
  - `components/registry/note-detail-view.test.tsx`: "offers in-browser verification", "lists what the proof hides".
  - Also `registry-results.test.tsx`, `registry-query.test.ts` and `chain-note.test.ts`.
  - On testnet, the e2e checks "registry proof verifies with snarkjs" and "proof rebuilt from on-chain note data verifies (browser path)".
- **Browser QA pending:** open a seeded note on the live deployment, click the button and see the green check; confirm no name, NIF, price or address appears anywhere.

## 5. Agent onboarding: email + passkey, no wallet, card, one-prompt activation

- **Server side.** Registration uses `@simplewebauthn/server` (ES256, discoverable, user verification). The COSE key becomes a P-256 key, which becomes the only signer of an OpenZeppelin smart account. The sponsor deploys and pays for the account, a card is issued, and `enable_card` is signed with the passkey through `/api/stellar/agent-tx/prepare` → `/submit`.
- **Tests.** `lib/passkey/cose.test.ts`, `lib/passkey/server.test.ts`, `lib/passkey/signature.test.ts` (DER → compact, low-S), `lib/stellar/agent-tx-auth.test.ts`, `lib/stellar/agent-tx.test.ts`, `lib/stellar/agent-tx-sponsor.test.ts`, `lib/agent/provision.test.ts`, and `components/agent/render.test.tsx` (onboarding states).
- **Live contracts.** `pnpm --filter @advance/scripts smoke:smart-account` checks the auth encoding against the live OpenZeppelin account contracts (DECISIONS.md, "Smart accounts").
- **On-chain, demo-signer path through the same endpoints.** `enable_card` for the three seed agents: [`82dbe317…`](https://stellar.expert/explorer/testnet/tx/82dbe31728a37288677de81eaf9240523b6af2bdff9e23166ea0cdf122001be0), [`42ab88b1…`](https://stellar.expert/explorer/testnet/tx/42ab88b1a54b4aa872e1b7c4907e4f62e8cda51b1241c3a9aeab88830f59fd3f), [`520d5528…`](https://stellar.expert/explorer/testnet/tx/520d5528e6ad950725dda8af5f829b6882f4862b1f0b886f31b3dc7c3255c2fd). The e2e agent: [`5fb08e4f…`](https://stellar.expert/explorer/testnet/tx/5fb08e4fa77eef5f5a64a15284791216d5c378a300f330dab41914cd7ada6c2a).
- **Browser QA pending:** a real passkey on a phone. Check passkey creation, the account and card being provisioned, one prompt for **Activate card**, and that no wallet, seed phrase or fee is ever shown.

## 6. Simulated purchase approved via ASA; `CardDraw` on-chain within ~10 s

- **The e2e run.**
  - `[asa] … AUTHORIZATION €3000.00 → APPROVED (spendable €3750.00, position chain, 422 ms)`.
  - `card_draw` [`ef1c2010…`](https://stellar.expert/explorer/testnet/tx/ef1c201004c0bd13e83db7c19fc6e8d8bc54c4d3c62a526c75a7c36a17af7887) was confirmed 8.5 s after the approval, 7.0 s of it transaction time. The check: "card_draw confirmed on-chain: €3,000 on credit".
  - A later €6,000 purchase was approved in 199 ms and drawn 5.4 s later: [`dd1e1f8a…`](https://stellar.expert/explorer/testnet/tx/dd1e1f8a263d6446c74f9f33859728d2be3360aeeb7eb397ff75b6906c2bafca).
- **The simulated network is the real pipeline.** It builds a Lithic-typed ASA request and runs it in-process through the same parser, decision, `CardAuthorization` row and `after()` draw as `POST /api/lithic/asa` (DECISIONS.md, "Card").
- **Tests.**
  - `lib/card/asa.db.test.ts`: "approves, records PENDING, then draws on-chain and confirms with the split", "is idempotent on the Lithic transaction token", "declines SUSPECTED_FRAUD for an unknown card and records nothing", "gives up on a slow RPC after 1.2 s and answers from the cache", "marks a failed draw FAILED and retries it from the sweep, at most 3 attempts".
  - `lib/card/lithic-mode.db.test.ts` (Lithic mode, signed ASA requests).
  - `lib/lithic/webhook.test.ts` (Standard Webhooks reference vector).
- **Not exercised:** a real Lithic sandbox key (none was available), i.e. `pnpm lithic:enroll` with a tunnel. **Browser QA pending:** the purchase sheet and the confirmation link.

## 7. A purchase above spendable is declined with `INSUFFICIENT_FUNDS`

- **e2e.** `[asa] … AUTHORIZATION €1000.00 → INSUFFICIENT_FUNDS (spendable €750.00, position chain, 216 ms)`, check "€1,000 purchase above spendable is declined (INSUFFICIENT_FUNDS)".
- **Tests.**
  - `lib/card/decision.test.ts`: "approves exactly at the limit (amount × 100_000 ≤ spendable)", "declines with INSUFFICIENT_FUNDS one cent above spendable", "subtracts pending holds and can go negative", "caps credit by lendable and leverage headroom".
  - `lib/card/asa.db.test.ts`: "declines INSUFFICIENT_FUNDS once pending holds use up spendable".
  - On-chain guard, contract `credit` tests: `liquidity_caps_draws`, `leverage_cap_limits_total_debt`, `credit_limit_is_half_the_agent_commission`.

## 8. Investors: deposit / withdraw with Freighter; APY and pool health

- **On the live deployment, 17:36 UTC.** `lib/wallet/testnet.e2e.test.ts` ran the browser transaction code with a throwaway keypair standing in for Freighter: Friendbot → `teurc.faucet` → deposit €100 [`707473cd…`](https://stellar.expert/explorer/testnet/tx/707473cd42dcddbd32f2624fec6fe4d5ae5fc6615fc632c3ca5613c8bfd26289) → withdraw €40 [`bf3b4576…`](https://stellar.expert/explorer/testnet/tx/bf3b45769f923bb179fda13a031c797f44d18b3f654a46b50598b18447f47049) → "Max" redeems the rest [`2a4018f4…`](https://stellar.expert/explorer/testnet/tx/2a4018f4f21fe11bc3fa891676010a7d04cadae3ca5c2c0187b713535cb9256e).
- **Seed investors.** €25,000 [`7bb0bccf…`](https://stellar.expert/explorer/testnet/tx/7bb0bccfbf09d8aa482573a5164807b23f5fbc38b01fa75b645143fd51b100fd) and €40,000 [`cd339a55…`](https://stellar.expert/explorer/testnet/tx/cd339a55ca63e60788caf179574928bd35f55c2d9412d631d6f61281230e33c0).
- **Tests.**
  - `lib/wallet/freighter.test.ts`, `use-freighter.test.ts`, `soroban.test.ts`, `pool.test.ts`, `faucet.test.ts`, `errors.test.ts`.
  - `components/invest/invest-view.test.tsx` (every state), `yield-math.test.ts` (the spec §5.6 figures 6.48%, 8.00%, 17.2%, €10,000 → €8,000), `pool-charts.test.ts`.
  - `lib/pool/apy.test.ts` (projected and trailing APY), and `app/api/routes.test.ts` "combines stats, APY, note counts, total advanced and the demo clock".
  - Contract `vault` tests: `deposit_withdraw_redeem_math`, `withdrawals_are_capped_by_lendable_cash`, `donations_do_not_move_the_share_price`.
- **Browser QA pending:** the Freighter extension (connect, testnet check, signing prompts), the pool health panel and the charts.

## 9. Settlement repays debt + interest, credits the card balance, grows junior; share price rises

- **On the live deployment.**
  - Note #2, settle [`82a5fc7a…`](https://stellar.expert/explorer/testnet/tx/82a5fc7af6c2e9365e89cde40718fa065f257a397b5b7c04cf760c295da44818): debt €930.56 repaid (incl. €17.61 interest), agent payout €6,089.44, junior +€7,020.00.
  - Note #3, settle [`5627c053…`](https://stellar.expert/explorer/testnet/tx/5627c05359b5bcd1e9e74a59e8fb91a74244a40a140bea47a7cb33d021444702): debt €1,381.56 repaid (incl. €20.21 interest), payout €11,018.44, junior +€12,400.00.
  - Junior now holds €29,420.00 (= €10,000 seed + €7,020 + €12,400), and the senior share price is 1.003056.
- **e2e, the worked example.** Settle [`f3556f45…`](https://stellar.expert/explorer/testnet/tx/f3556f4598b3385142d7ca31bc02c4b69a7819ac742dd911a9e71060df8fae96): interest **€88.77**, payout **€4,411.23**, junior **+€7,500.00**, the treasury paid €15,000, and the share price went from 1.000000 to 1.007989. The `NoteSettled` event carried the same figures.
- **Contract tests.**
  - `worked_example`: `single_accrual_matches_the_spec`, `daily_accruals_compound_to_about_90_08`, `settled_event_layout`.
  - `outcomes`: `settle_without_carried_debt`, `settle_needs_the_treasury`, `settle_repays_carried_debt_first`, `settle_when_debt_exceeds_the_agents_half`.
  - `integration_tests`: `worked_example::card_draw_then_settle_reproduces_the_worked_example`, `lifecycle::a_settlement_repays_carried_debt_first`, `lifecycle::an_odd_commission_settles_with_the_extra_cent_to_explorador`.
- **Browser QA pending:** the Confirm escritura dialog, and the agent's "Deal settled" activity and card balance.

## 10. Cancel → carried debt → write-off after the grace period, junior first

- **On the live deployment.** Note #4 cancel [`216e6626…`](https://stellar.expert/explorer/testnet/tx/216e66269afa48b91426ee4163244b07e63ee8d32169d66ec454c34c602311f0) moved €1,514.83 into carried debt, with a grace deadline of 22 Jul 2027 on the protocol clock. Written off so far: €0, by design, because the seed leaves this debt in its grace period for the demo.
- **e2e.** Cancel [`3cc4f801…`](https://stellar.expert/explorer/testnet/tx/3cc4f8012acfb8ac30f560347871c5ac1eec471e6176ba327ab4811bd21f32c4) moved €1,588.77 into carried debt, and the grace deadline was cancel + 180 protocol days. A write-off before the deadline was refused (`GraceNotOver`). After +181 days [`8752ac51…`](https://stellar.expert/explorer/testnet/tx/8752ac51eda4925deaadc94caa27a2a01abc36f8f0912563959a1ef3f1c677a9), `write_off` [`892989ae…`](https://stellar.expert/explorer/testnet/tx/892989aee75067f41401a9076116d407e3415a43ea8fdff1f8cc3b2d0140e250) charged junior **€1,683.31 of €1,683.31**. Senior was untouched, the agent was blocked, and `written_off_total` grew by the loss.
- **Contract tests.**
  - `outcomes`: `cancel_then_write_off_hits_junior_only`, `write_off_reaches_senior_only_after_junior_is_exhausted`, `cancel_uses_the_card_balance_first`.
  - `credit`: `blocked_agents_get_no_credit`.
  - `integration_tests`: `defaults::cancel_grace_then_write_off_hits_junior_and_blocks_the_agent`, `defaults::defaults_wipe_out_junior_before_senior`, `defaults::a_years_late_escritura_settles_short_and_the_rest_is_written_off`.
- **Browser QA pending:** the Cancel dialog, the carried-debt banner with its countdown, and the Write off button (enabled only after the deadline).

## 11. Design: explorador.pt look, light and dark, phone width

- **Implementation** (DECISIONS.md, "Web: design system and shell").
  - Sora is self-hosted, from explorador.pt's own font file.
  - The nav is a blue-600 bar; headlines are two-tone; cards are rounded white with slate borders.
  - Dark mode is class-based with a Light / System / Dark toggle and no flash.
  - The agent app is mobile-first: a bottom-sheet purchase flow on phones and 44 px touch targets.
  - `/design` is a design-system reference page. Server-render tests cover every agent and investor state.
- **Pending browser QA:** compare with explorador.pt side by side in light and dark mode, and at 375 px width.

## 12. "Reset demo" restores the seeded state

- **Same code path.** `pnpm demo:reset` and the admin button (`POST /api/admin/demo/reset`, `DEMO_MODE` only) both run `runDemoReset` in `lib/demo/reset.ts`.
- **The live deployment came out of a reset.** The run logged "New deployment active: pool CBZGR3MQ…" (32 s), then "seed done in 129 s: 5 notes, 13 card spends, protocol day D120", then "Demo reset complete in 161 s".
- **On-chain events match the seed plan exactly** (spec §11.2 and `lib/demo/seed-data.ts`): 5 `note_minted`, 5 `line_opened`, 13 `card_draw`, 2 `note_settled`, 1 `note_cancelled`, 5 `clock_advanced` (+120 days), 3 `card_enabled`, and 2 seed deposits.
- **Tests.** `lib/demo/deploy.test.ts` ("activates the new deployment, detaches old CPCV note ids, resets card consent and writes the file"), `lib/demo/seed-data.test.ts`, and `lib/admin/routes.test.ts` ("refuses the demo clock and reset when DEMO_MODE is off").
- **Browser QA pending:** the button itself, its SSE progress log and "Reload the admin panel".

---

## Appendix A: spec §12.1 required tests

| Required test | Where |
|---|---|
| Groth16: committed fixture verifies; tampered input and tampered proof rejected | `contracts/shared/src/groth16.rs`: `verifies_the_snarkjs_fixture_proofs`, `rejects_a_tampered_public_input`, `rejects_a_tampered_proof` |
| `cpcv_note`: happy path, duplicate nullifier and commitment, wrong attester key, wrong nullifier-secret commitment, escritura in the past, wrong recipient, soulbound | `contracts/cpcv_note/src/test.rs`: `mint_happy_path`, `rejects_*`, `notes_are_soulbound` |
| `advance_pool`: deposit/withdraw/redeem math | `vault.rs`: `deposit_withdraw_redeem_math`, `rounding_never_pays_out_dust` |
| Worked example, single accrual (€88.77 / €4,411.23) and 90 daily accruals (≈ €90.08) | `worked_example.rs`: `single_accrual_matches_the_spec`, `daily_accruals_compound_to_about_90_08` |
| Draw order, credit limit, leverage cap, liquidity cap | `credit.rs`: `draws_spend_card_balance_first_then_earliest_escritura`, `credit_limit_is_half_the_agent_commission`, `leverage_cap_limits_total_debt`, `liquidity_caps_draws` |
| Settle with and without carried debt; debt above the agent's half | `outcomes.rs`: `settle_without_carried_debt`, `settle_repays_carried_debt_first`, `settle_when_debt_exceeds_the_agents_half` |
| Cancel → grace → write-off (junior first, senior after) | `outcomes.rs`: `cancel_then_write_off_hits_junior_only`, `write_off_reaches_senior_only_after_junior_is_exhausted` |
| Blocked agent; duplicate `auth_ref` | `credit.rs`: `blocked_agents_get_no_credit`, `duplicate_auth_ref_is_rejected` |
| Invariant fuzz test (≥ 500 operations) | `fuzz.rs`: `invariant_holds_over_random_operations`, 3 seeds × 600 operations, the §5.3 invariant asserted exactly after each one |
| `advance_clock`: demo mode only, admin only, monotonic, accrues first | `clock.rs`: `advance_clock_only_in_demo_mode`, `advance_clock_is_admin_only`, `advance_clock_is_capped_and_monotonic`, `advance_clock_accrues_first` |
| Circuit: valid witness; each constraint violated individually | `circuits/test/circuit.test.mjs` (21 tests) |
| TypeScript: `agent_field` parity, `property_hash`, proof formatting round trip, ASA decisions, interest display math | `cpcv_note` `agent_field_matches_the_typescript_encoding` + e2e parity on testnet for a C… and a G… address; `lib/zk/zk.test.ts` (agent_field, property_hash, snarkjs ⇄ Soroban formatting); `lib/stellar/proof.test.ts` ("round-trips (negate / un-negate A)"); `lib/card/decision.test.ts`, `lib/card/asa.db.test.ts`; `components/agent/interest.test.ts` |
| E2E on testnet (`pnpm e2e`) | appendix B |

## Appendix B: `pnpm e2e` run, 25 Oct 2026 17:33–17:35 UTC

The run used its own database (`advance_e2e`) and fresh contracts: teurc `CBQQEQODRNHROVAHL5QUL26PLXT74N6KMQJMXLOBVLMY5FSTGYSXZY7D`, cpcv_note `CDFJVCQ2WDUJP6ORSXNBQVLUYC6AKHRXTDTJ4BWIC4JSAMRPYH6ZUKCV`, advance_pool `CDIC77RM7LO2VLD7RJQGYBTDZW5ALUR6RNJ52QL3TZE5HPMWCNBNAWKD`. The agent `e2e-agent@demo.explorador.pt` had smart account `CCC7…KC36`; the investor was `GC2A…BQBJ`. **35 checks passed in 107 s.** The output was captured by the deploy workstream; the hashes below were re-checked on-chain.

Figures: interest €88.77 · payout €4,411.23 · junior top-up €7,500.00 · share price 1.007989 · written off €1,683.31 · junior loss €1,683.31.

| Step | Tx |
|---|---|
| deploy teurc / cpcv_note / advance_pool | [`57c4914b…`](https://stellar.expert/explorer/testnet/tx/57c4914b67e167aa691f2d97d508a16e80f51dc1e12118f1967fe903b04acc32) / [`b00461a2…`](https://stellar.expert/explorer/testnet/tx/b00461a2df8736aa2f57dd8ee0b48cd16a4995d9b37129b26ee5a886105f34df) / [`0db75f2c…`](https://stellar.expert/explorer/testnet/tx/0db75f2c9694419ebac4aaace08e4ac005ec0e42b585d9cd1896fd7997ed37d6) |
| `set_pool` · treasury mint · `junior_deposit` | [`776841bb…`](https://stellar.expert/explorer/testnet/tx/776841bbb8e091d74eb4961f371644c095feed4a124475067461097b1145a600) · [`626b7f58…`](https://stellar.expert/explorer/testnet/tx/626b7f584a290cdcccc4df6fb0821e44956cfdbb018287eb3357b421b7c8a83f) · [`4f9f63a9…`](https://stellar.expert/explorer/testnet/tx/4f9f63a90576cc470e774f2ddc7707ee8acac6e1c60178a4d5ec89f8a9347b4c) |
| investor deposit | [`47a268fb…`](https://stellar.expert/explorer/testnet/tx/47a268fb2eb2c60a4ffefedc24cede551bcf0cca1ee87fd06e7cc3d5a83d5f41) |
| `enable_card` | [`5fb08e4f…`](https://stellar.expert/explorer/testnet/tx/5fb08e4fa77eef5f5a64a15284791216d5c378a300f330dab41914cd7ada6c2a) |
| mint note 1 (on-chain Groth16) | [`eadd96db…`](https://stellar.expert/explorer/testnet/tx/eadd96db6b853aa7697cde60f9b15e8915eae7f7b70846fe374757d2c3b01598) |
| `card_draw` €3,000 (ASA) | [`ef1c2010…`](https://stellar.expert/explorer/testnet/tx/ef1c201004c0bd13e83db7c19fc6e8d8bc54c4d3c62a526c75a7c36a17af7887) |
| `advance_clock` +90 days | [`3337f075…`](https://stellar.expert/explorer/testnet/tx/3337f075b40e82b9fec405175243577b4de8341ee773f96c42897df1c3edd254) |
| settle note 1 | [`f3556f45…`](https://stellar.expert/explorer/testnet/tx/f3556f4598b3385142d7ca31bc02c4b69a7819ac742dd911a9e71060df8fae96) |
| mint note 2 | [`bd7a882a…`](https://stellar.expert/explorer/testnet/tx/bd7a882ab7351a77a5daeb5af0870a89c0948f8477d47293ae7b864750756e9c) |
| `card_draw` €6,000 (ASA; €4,411.23 from the balance, €1,588.77 on credit) | [`dd1e1f8a…`](https://stellar.expert/explorer/testnet/tx/dd1e1f8a263d6446c74f9f33859728d2be3360aeeb7eb397ff75b6906c2bafca) |
| cancel note 2 | [`3cc4f801…`](https://stellar.expert/explorer/testnet/tx/3cc4f8012acfb8ac30f560347871c5ac1eec471e6176ba327ab4811bd21f32c4) |
| `advance_clock` +181 days | [`8752ac51…`](https://stellar.expert/explorer/testnet/tx/8752ac51eda4925deaadc94caa27a2a01abc36f8f0912563959a1ef3f1c677a9) |
| `write_off` | [`892989ae…`](https://stellar.expert/explorer/testnet/tx/892989aee75067f41401a9076116d407e3415a43ea8fdff1f8cc3b2d0140e250) |

All 35 checks, in order:

1. Deploy seeds the junior tranche with €10,000.
2. Pool params match §5.1.
3. Treasury holds 1,000,000 − 10,000 tEURC.
4. First deposit mints 1:1 eaSR shares.
5. Agent provisioned (smart account + simulated card).
6. `agent_field` parity TS == contract, for a C… address.
7. `agent_field` parity TS == contract, for a G… address.
8. Card enabled on-chain by the smart account.
9. Note #1 stores €15,000 / €7,500.
10. Credit line €3,750.
11. Available credit €3,750.
12. SEP-50 `token_uri` = base_uri + "/" + id.
13. Note transfer fails (soulbound).
14. Registry proof verifies with snarkjs.
15. Proof rebuilt from on-chain note data verifies.
16. €3,000 purchase approved by the ASA pipeline.
17. `card_draw` confirmed on-chain on credit.
18. €1,000 above spendable declined (INSUFFICIENT_FUNDS).
19. Interest over 90 days = €88.77.
20. Card balance credited €4,411.23.
21. Debt repaid, note Settled.
22. Treasury paid €15,000.
23. Junior topped up €7,500.
24. Senior share price rose.
25. €6,000 purchase approved.
26. Card balance first, then credit.
27. Cancel moved line debt to carried debt.
28. Grace deadline = cancel + 180 protocol days.
29. Write-off refused before the deadline (`GraceNotOver`).
30. Junior absorbed the written-off debt.
31. Senior untouched.
32. Agent blocked, carried debt cleared.
33. `written_off_total` grew by the loss.
34. Indexer reconciled CPCV statuses (SETTLED, WRITTEN_OFF).
35. `NoteSettled` event carries €88.77 / €4,411.23.

## Appendix C: transactions of the seeded live deployment

Card draws (13), in order: [`fdd39075…`](https://stellar.expert/explorer/testnet/tx/fdd3907583d5b1d27b83d8ff7180b1b4f2258117d25fe2f652738fc5a52118e6) €1,240.00 · [`f64b9a89…`](https://stellar.expert/explorer/testnet/tx/f64b9a89ad3fab72512e5fe8efa1c138da10fd6d4bc5798df59d0ca694d698f9) €864.25 · [`534d9d49…`](https://stellar.expert/explorer/testnet/tx/534d9d49c0583a322adf1b6fcc05df3970bfb81b41041698613c5aa2d99acd48) €1,385.40 · [`2f44968d…`](https://stellar.expert/explorer/testnet/tx/2f44968d776352ff19889550fe40409cf31edbd57e73c4686a1efc624d84f613) €899.99 · [`aa1a7861…`](https://stellar.expert/explorer/testnet/tx/aa1a7861765ae9e7cc0034828850e0becd5bcc1af29db9fae945ebeecac900ae) €48.70 · [`3f26b07e…`](https://stellar.expert/explorer/testnet/tx/3f26b07ef4416ec19b7f8c240ca4d185ced6a1c374fca66d86269cf886b1afc8) €574.61 · [`fc0e0e7b…`](https://stellar.expert/explorer/testnet/tx/fc0e0e7b67763454c2aba0079c5f4f359cd722bf550ce589ea61d9231431984f) €1,149.00 · [`d217888a…`](https://stellar.expert/explorer/testnet/tx/d217888a6c686266e7ab4bb740bf5f30fcf6e38b641240e06dfee4f9e4dda066) €212.35 · [`f5d1ecfb…`](https://stellar.expert/explorer/testnet/tx/f5d1ecfbc57f9e71835aa0175416de7c8bbdfefa8fcdc4f4b2eb56266af75463) €1,099.00 · [`6622eea0…`](https://stellar.expert/explorer/testnet/tx/6622eea0b3b1e6e406dd78a41a850e0bb9da0de1af715e134583e18bb5e07da6) €401.00 · [`3bc6418f…`](https://stellar.expert/explorer/testnet/tx/3bc6418f306df2e942327d826c8307cb0bf552cc606ad1fb414650e39ea40eeb) €4.80 · [`feca9b99…`](https://stellar.expert/explorer/testnet/tx/feca9b99ea6cac94ede5fe065553d06b58718eaffc0369d01d8f0e2fe619e171) €96.50 · [`d3d46850…`](https://stellar.expert/explorer/testnet/tx/d3d4685084a940bbfbc24297f05399f47d97f15c1c513116aa962030c6eb115c) €385.90.

Protocol clock advances (+30, +30, +15, +15, +30 days): [`6021630f…`](https://stellar.expert/explorer/testnet/tx/6021630f876bfc9afd1797e5452391f8267dd22ee38bd523514a04d7349db5f4) · [`126eb54b…`](https://stellar.expert/explorer/testnet/tx/126eb54b592aeb4d35c9c3d12af0a59b43104bc49abfc32d76eb85b308501224) · [`784d479f…`](https://stellar.expert/explorer/testnet/tx/784d479fb288e43c6a299819fc1d9b8ae2c2f7ccafb9d99cedb039d904e89178) · [`4584324c…`](https://stellar.expert/explorer/testnet/tx/4584324c6a59552d688d37c71e93e009e0868fb2e0e802bdba1537acd8fc9dca) · [`fef6eb57…`](https://stellar.expert/explorer/testnet/tx/fef6eb5772395d7ff30011141bd3fda618c8d9e22b6b62e7eafea63a18b7851d).

Mints, settlements, the cancellation, card enables and deposits are linked in items 3, 5, 8, 9 and 10.

## How the evidence was gathered

- **Chain reads.** RPC simulation of `cpcv_note.count()` and `advance_pool.stats()` from the null account, `getEvents` over the three contract ids, and `getTransaction` for the cited hashes, all against `https://soroban-testnet.stellar.org`, with no keys involved.
- **Test runs.** The commands in item 1, on a clean checkout of this branch. The database tests ran against a throwaway database that was dropped afterwards.
- **e2e and reset figures.** These come from the deploy workstream's captured `pnpm e2e` and `pnpm demo:reset` output; their transactions were re-checked on-chain.
