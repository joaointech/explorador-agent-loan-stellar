# Decisions

Choices made where `spec.md` was silent, or where the product owner gave new direction. Each workstream appends to its own section (keeps parallel branches merge-friendly). Format: `- YYYY-MM-DD: decision (why)`.

## Product and scope

- 2026-10-25: **Standalone hackathon project**: new database and new API; no integration with explorador.pt / irrealista (product owner). `../irrealista` and `../explorador-house-flash-loan` are read-only design/code inspiration only.
- 2026-10-25: Domain is **advance.explorador.ai** (product owner). Production `WEBAUTHN_RP_ID=advance.explorador.ai`; `localhost` in dev. Default `EMAIL_FROM` uses `advance@explorador.ai`; seed agents keep the spec's `@demo.explorador.pt` addresses (never emailed).
- 2026-10-25: Liquidity model as in the spec: one pooled senior vault (`eaSR`) backed by all CPCV Notes, with explorador's junior first-loss tranche.

## Engineering (repo-wide)

- 2026-10-25: Monorepo as in spec §6 with pnpm 9 workspaces. Next.js 16.4.3 / React 19.3 / Tailwind CSS 4.3 (latest stable at kickoff).
- 2026-10-25: Local Postgres is exposed on host port **5433** (5432 is often taken by a local install).
- 2026-10-25: Root-level `scripts/` is a workspace package (`@advance/scripts`) run with `tsx`; it imports shared code from `apps/web/lib` through the `@/` alias, so modules shared with scripts must not import `server-only`.
- 2026-10-25: API amounts are decimal strings of stroops (bigint-safe); shared request/response types live in `apps/web/lib/types/api.ts`.
- 2026-10-25: Node **24 LTS** pinned per project via `.npmrc` `use-node-version` (Prisma 7 rejects the machine's Node 23); run Node tools through pnpm.
- 2026-10-25: Prisma 7 uses the `prisma-client` generator (output `apps/web/lib/generated/prisma`, generated on `postinstall`), `prisma.config.ts` for the datasource URL, and the `@prisma/adapter-pg` driver adapter for both local Postgres and Neon.
- 2026-10-25: Next.js `cacheComponents` is **off** (dynamic-by-default model): nearly every page shows live chain state. Route protection uses Next 16 `proxy.ts` (Middleware was renamed).
- 2026-10-25: Workstreams build against stub interfaces committed up front (`lib/auth/session.ts`, `lib/stellar/contracts.ts`, `lib/stellar/smart-account.ts`, `lib/lithic/cards.ts`, `lib/zk/agent-field.ts`, `contracts/shared`), so they can run in parallel; each owner replaces its stubs.

- 2026-10-25: Contracts use **soroban-sdk 28.0.0**, not 29.x: OpenZeppelin `stellar-tokens`/`stellar-access`/`stellar-macros` 0.8.0 require `soroban-sdk ^28`, and mixing SDK majors breaks the build. Rust **1.94.0** is pinned in `contracts/rust-toolchain.toml` (SDK 28 needs ≥ 1.91).
- 2026-10-25: `soroban-fixed-point-math` is **not used**: 1.5.0 depends on `soroban-sdk ^25`, which would pull a second SDK into the build. Mul-div with explicit rounding is implemented in `contracts/shared/src/math.rs`.
- 2026-10-25: Contract events use `#[contractevent]` with default settings: first topic = snake_case struct name (`note_minted`, `card_draw`, …), fields in the data map. SEP-56 `Deposit`/`Withdraw` follow the standard's layout.

## Contracts: advance_pool and teurc

## ZK circuit and cpcv_note

## Web: design system and shell

## Web: landing and registry pages

## Auth and database

## Stellar service and indexer

## Smart accounts (agent passkey wallet)

## Card (Lithic ASA)

- 2026-10-25: **Simulated card network while `LITHIC_API_KEY` is unset** (no key exists yet): `createAgentCard` issues `sim_card_…` cards (random last4); `POST /api/agent/card/simulate` builds an ASA request typed against the SDK's `CardAuthorizationApprovalRequestWebhookEvent` (USD cents, Visa, token `sim_txn_…`) and runs it through the same parser and pipeline as `POST /api/lithic/asa`, in-process: same decision, same `CardAuthorization` row, same `after()` draw; `via: "simulated"`. Reveal returns obviously fake details (`4000 0000 0000 <last4>`, CVV `000`). A simulated card keeps using the simulated network even after a key is added; `createAgentCard` replaces it with a Lithic card when called again with a key.
- 2026-10-25: Lithic facts that refine the spec (verified in `lithic@0.148.0` sources and docs.lithic.com): enrollment is `responderEndpoints.create({ type: "AUTH_STREAM_ACCESS", url })` + `authStreamEnrollment.retrieveSecret()` (returns `whsec_…`, created on first call; signed headers start appearing minutes later); simulate is `transactions.simulateAuthorization({ amount, descriptor, pan })` → `{ token }`, the same token the ASA request carries; ASA statuses are AUTHORIZATION, FINANCIAL_AUTHORIZATION, BALANCE_INQUIRY and CREDIT_/FINANCIAL_CREDIT_AUTHORIZATION (credit decisioning only); reversals never reach ASA; the response may echo `token`; Lithic waits up to 6 s, retries once on 5xx, declines on 4xx; sandbox writes are limited to 1/s (simulations, responder endpoints) and 2/s (cards); card-creation idempotency keys must be UUIDs.
- 2026-10-25: ASA signatures follow Standard Webhooks: base64 HMAC-SHA256 of `${webhook-id}.${webhook-timestamp}.${rawBody}` keyed with the base64-decoded secret (minus `whsec_`), `webhook-signature` = space-separated `v1,<sig>` list, 5-minute timestamp tolerance. Implemented with `node:crypto` and tested against the reference vector and the SDK's own verifier (`standardwebhooks` isn't a direct dependency, and the SDK verifier needs a client with an API key). As specced, unsigned requests are accepted only while `LITHIC_ASA_HMAC_SECRET` is unset; set it on every deployment with a Lithic key (card tokens are unguessable UUIDs and draws can only pay `card_settlement`, so the window is a griefing risk, not a theft risk).
- 2026-10-25: `card_enabled` from a live `agent_position` read decides CARD_PAUSED; `Agent.cardEnabledOnChain` (its DB mirror, written by the agent-tx/seed flows) decides only when the read fails, and is corrected from the live read in `after()`. The spec checks the DB flag alone, which would decline every purchase if a flow forgot to update it.
- 2026-10-25: Decision details the spec leaves open: unknown card → SUSPECTED_FRAUD for every status, nothing recorded (no agent to attach a row to); no live read and no cache → INSUFFICIENT_FUNDS; without live stats the position's own `borrowable_now` (the same min, computed on-chain) bounds credit; with a cached position, approved draws CONFIRMED after `cachedAt` also count as pending holds; zero-amount purchases and credits are approved and recorded with `chainStatus = CONFIRMED` and no tx (nothing to draw); balance inquiries are not recorded (`balance.amount = available` = spendable cents, 0 for a paused card). Declined rows keep the schema default `chainStatus = PENDING`: `chainStatus` is meaningful only for APPROVED rows, so consumers filter on `decision` (pending holds, failed-draw alerts, pollers).
- 2026-10-25: `Agent.cachedPosition` holds `jsonify(AgentPosition)` (bigints as decimal strings) and `cachedAt` is when that read *started*; it is written after every live read and after every draw, only if newer than what is stored.
- 2026-10-25: Draw lifecycle: `after()` claims the row atomically (PENDING → SUBMITTED, `attempts + 1`), calls `cardDraw(agent, cents × 100_000, sha256(lithic token))`, then CONFIRMED with split + tx hash or FAILED. At most 3 attempts in total. Contract error `DuplicateDraw` (#12) means an earlier attempt landed: the row becomes CONFIRMED, with the split recovered from indexed `card_draw` events when available. The status poll re-arms an approved draw still PENDING after 15 s (lost `after()`).
- 2026-10-25: Retry sweep (`retryDraws`, `/api/cron/retry-draws`): FAILED draws, plus PENDING/SUBMITTED older than 2 minutes, with fewer than 3 attempts, 5 per run, oldest first; SUBMITTED rows out of attempts become FAILED unless found in indexed events. One sweep at a time (`pg_try_advisory_xact_lock`); optional `agentId` scope. The route accepts an admin session or `Authorization: Bearer $CRON_SECRET` (new optional env var, what Vercel Cron sends); the admin page can also call `retryDraws()` directly (prefer `after()`: each retry is a testnet transaction).
- 2026-10-25: Simulate API: `amountEur` > 0, ≤ €50,000, at most 2 decimals; `merchant` 1–40 chars. Lithic mode reads our ASA row back by transaction token (waits up to 4 s); when Lithic declined without consulting us the decline is recorded with Lithic's `result` as `declineReason`; if Lithic approved without calling our responder the API returns 502 `ASA_NOT_REACHED` (enroll the URL). Lithic writes are spaced in-process (1.1 s for simulations, 0.55 s for cards) and a simulate waiting more than 4 s for its slot gets 429; the UI should still debounce.
- 2026-10-25: Card creation: `cards.create({ type: "VIRTUAL", memo: <agent user id>, card_program_token: "00000000-0000-0000-1000-000000000000" })` (sandbox Visa test BIN) with a deterministic UUID `Idempotency-Key` derived from the user id, so a retried onboarding gets the same card. `createAgentCard` returns the card already on the Agent row if any, and stores a new one on the row when the row exists; otherwise the caller stores it. Amounts stay USD cents treated as EUR 1:1 (spec): `simulate/authorize` is called without `billing_currency`.
- 2026-10-25: Local Lithic dev needs a public URL: run a tunnel (`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) and `pnpm lithic:enroll --url <https tunnel URL>`; the script prints the `LITHIC_ASA_HMAC_SECRET=` line (`--status`, `--disenroll` for housekeeping).
- 2026-10-25: Database-backed tests run against `TEST_DATABASE_URL` (a separate database prepared with `prisma db push`; read from the shell or `.env.local` by `apps/web/vitest.config.mts`) and are skipped when it is unset, so tests never touch the dev database.

## Agent app

## Invest dashboard

## Admin panel and CPCV pipeline

## Deploy, seed and e2e
