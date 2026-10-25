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

- 2026-10-25: `invokeAsOperator(contract, fn, args, { extraSigners, decode })` names the target contract explicitly (spec §9.3 has `(fn, args, extraSigners?)`, but there are three contracts). The lower-level `invokeContract({ contractId, fn, args, source, signers, decode })` and `submitAndPoll(tx)` are exported for other signed flows (e.g. sponsor-sourced agent transactions).
- 2026-10-25: Return values are decoded by our own strict ScVal decoders (`lib/stellar/decode.ts`), not the generated bindings: the bindings only exist after a deploy and expose snake_case shapes. Decoders fail on a missing field but accept integer-width differences (u32/u64/i128) and enum variants as `Vec[Symbol]`, a bare symbol or a u32 discriminant, since the contracts are built in parallel.
- 2026-10-25: Views simulate with the all-zero `G…WHF` null source account (like the SDK contract client): no funded key and no `getAccount` round trip, which keeps the ASA reads inside the 1.2 s budget (~130 ms per simulation on testnet).
- 2026-10-25: Operator transactions are serialized by an in-process promise chain plus `pg_advisory_xact_lock(key)` inside a Prisma interactive transaction (key = first 8 bytes of sha256 of the source account). Transaction-level locks work through Neon's transaction pooler, and a process holds at most one DB connection per account while waiting. The lock is held from `getAccount` until the transaction is final, so the next build always sees the committed sequence; a `txBadSeq` (someone used the key without the lock) triggers one rebuild.
- 2026-10-25: Auth entries with Address credentials (treasury for settle/junior/fees, admin for advance_clock) are signed with `authorizeEntry` (CAP-71 v2 credentials on testnet protocol 29), then the transaction is re-simulated in enforcing mode before assembly, so signatures are checked and their verification cost is priced. Verified end to end on testnet. When a role shares the operator's key, the entry is source-account credentials and needs no extra signature.
- 2026-10-25: Inclusion fee 10,000 stroops (resource fees come from simulation), transaction time bounds 60 s, polling up to 75 s. A timeout raises `TX_TIMEOUT` with the hash so callers (and the indexer) can reconcile later.
- 2026-10-25: Stellar errors are `HttpError` subclasses, so any `route()` handler maps them without extra code: contract errors become `ContractError` with the shared numbering as SCREAMING_SNAKE codes (`DUPLICATE_DRAW`, `GRACE_NOT_OVER`; 404 for `UNKNOWN_NOTE`, 403 `NOT_AUTHORIZED`, 400 for bad input, else 409); `NOT_DEPLOYED`/`CONTRACT_MISSING`/`NOT_CONFIGURED` are 503, RPC trouble 502/504. `isContractError(err, "DuplicateDraw")` helps callers branch.
- 2026-10-25: Deployment lookup: newest active `Deployment` row for `STELLAR_NETWORK`, else `deployments/<network>.json` (searched from the cwd, `../` and `../../`, so Next.js, scripts and the repo root all find it), else `null`. Cached 5 s; `invalidateDeploymentCache()` for deploy/reset flows. On Vercel the DB row is the source of truth (the JSON file isn't traced into the serverless bundle).

## Smart accounts (agent passkey wallet)

## Card (Lithic ASA)

## Agent app

## Invest dashboard

## Admin panel and CPCV pipeline

## Deploy, seed and e2e
