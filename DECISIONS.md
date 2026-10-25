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

- 2026-10-25: **`open_line` takes the `Note` by value** (`PoolInterface::open_line(env, note: Note)`): Soroban forbids contract re-entry, so the pool cannot call `cpcv_note.get` while `cpcv_note.mint` is running (spec §7.2 step 10 / §7.3 deviation, orchestrator decision). The pool authenticates with `note_contract.require_auth()` (cpcv_note is the direct invoker) and checks the split; `settle` still reads the note with `NoteClient::get` (no re-entry there). `cpcv_note.set_status` must not call back into the pool.
- 2026-10-25: **Rounding surplus goes to junior**: debts round up (§5.2), so a draw or repayment can move the book debt a few stroops more than the cash that changed hands. `Pool::book_rounding` credits that surplus (always ≥ 0) to `junior_assets`, so the §5.3 invariant holds exactly (tested with zero tolerance) instead of accumulating dust. Example: the §5.6 settlement adds €7,500 + 1 stroop to junior.
- 2026-10-25: `write_off` charges the tranches exactly the decrease in `total_debt` (junior, then senior, then — only if both are exhausted — unclaimed fees); `DebtWrittenOff.amount` is the carried debt as displayed (rounded up), so `junior_loss + senior_loss` can be ≤ 1 stroop below it.
- 2026-10-25: A settlement **shortfall** (line debt > agent's half) becomes carried debt and starts the grace period if none is running (the spec only sets a deadline in `cancel`); carried debt therefore always has a deadline and can be written off. `cancel` and `settle` clear the deadline once carried debt reaches 0.
- 2026-10-25: Partial repayments (carried debt from the card balance or a later settlement, settlement shortfalls) pay interest first, then principal; the scaled debt removed rounds down (never clears more debt than paid).
- 2026-10-25: `card_draw` checks, in order: duplicate `auth_ref` (`DuplicateDraw`, before the card checks; failed draws don't consume the ref), `CardNotEnabled`, then for the credit part `AgentBlocked`, `InsufficientCredit`, `InsufficientLiquidity`, `LeverageCapExceeded`. Used refs are persistent entries (~90-day TTL).
- 2026-10-25: `NoteCancelled.debt_carried` = the line debt moved into carried debt (before the card-balance repayment); `grace_deadline` is the agent's deadline after the operation.
- 2026-10-25: `PoolStats`: `utilization_bps = total_debt / (total_debt + lendable)`; `share_price_scaled = (senior_assets + 1) × SCALE / (supply + 1)` (same virtual offsets as the conversions); `leverage_x100 = total_debt × 100 / junior_assets` (u32::MAX if junior is 0 with debt outstanding).
- 2026-10-25: eaSR uses OpenZeppelin's `TotalSupply` contract type (`Base` balances + supply counter) so SEP-41 `burn` keeps the vault supply right; the vault math is ours (§5.5). SEP-56 semantics follow OpenZeppelin: `operator` authorizes; if `operator != from` it spends `from`'s tEURC allowance, if `operator != owner` it spends `owner`'s eaSR allowance; `max_deposit`/`max_mint` = i128::MAX; `deposit`/`withdraw` events reuse `stellar_tokens::vault` (OpenZeppelin SEP-56 layout). Vault views return `Result<i128, Error>` (overflow → `Error::Overflow`); the on-chain value is the same i128.
- 2026-10-25: No new error variants. Constructor param validation (`protocol_fee_bps` and `ltv_bps` ≤ 10,000, `max_leverage` ≥ 1), `advance_clock(0)`, amounts ≤ 0 and amounts above the caller's position (`withdraw`, `redeem`, `withdraw_balance`, `junior_withdraw` > junior, `claim_fees` > fees) fail with `InvalidAmount`; amounts above lendable / pool cash fail with `InsufficientLiquidity`.
- 2026-10-25: TTLs: instance extended to ~30 days (threshold 15) on every call, views and SEP-41 methods included (OpenZeppelin leaves instance TTL to the implementor); persistent records (lines, agents, draw refs, eaSR and tEURC balances) to ~90 days (threshold 45).
- 2026-10-25: teurc keeps a plain stored admin (`admin.require_auth()` on `mint`) instead of OpenZeppelin Ownable (no ownership-transfer surface needed); its errors use the shared numbering (`InvalidAmount` for ≤ 0 and for faucet amounts above 25,000 tEURC). Unused `stellar-access`/`stellar-macros` deps were dropped from teurc and advance_pool; advance_pool tests use teurc as a dev-dependency.
- 2026-10-25: `set_blocked` emits no event (none listed in the spec).

## ZK circuit and cpcv_note

## Web: design system and shell

## Web: landing and registry pages

## Auth and database

## Stellar service and indexer

## Smart accounts (agent passkey wallet)

## Card (Lithic ASA)

## Agent app

## Invest dashboard

## Admin panel and CPCV pipeline

## Deploy, seed and e2e
