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

- 2026-10-25: Initial migration `init` is generated from `schema.prisma` (spec §9.1) plus one additive column, `EmailCode.createdAt`, which drives the per-email resend cooldown and hourly cap from Postgres (works across serverless instances, unlike an in-memory limiter).
- 2026-10-25: `lib/db` creates the Prisma client lazily on first property access (a Proxy over the singleton), so importing it never reads env. Scripts import it through `@/lib/db` (verified with `tsx --tsconfig scripts/tsconfig.json`); they should run with `tsx --env-file=../apps/web/.env.local` (or call `process.loadEnvFile` before the first query) and end with `db.$disconnect()`.
- 2026-10-25: Prisma 7's `migrate dev` does not regenerate the client: run `pnpm --filter web db:generate` after creating a migration. `pnpm --filter web db:reset` = `prisma migrate reset --force`, for dev databases only (Prisma refuses to run it for an AI agent without the user's consent).
- 2026-10-25: PII encryption (`lib/crypto`): AES-256-GCM with a random 96-bit IV and 128-bit tag over UTF-8 JSON, stored as `iv ‖ tag ‖ ciphertext` bytes; key = `PII_ENCRYPTION_KEY` (64 hex chars). No key-version prefix: a single key for the hackathon, rotating it would mean re-encrypting rows.
- 2026-10-25: Email sign-in codes are stored as HMAC-SHA256(key = `SESSION_SECRET`, message = normalized email + code), i.e. "SHA-256 + SESSION_SECRET" as a proper keyed hash, bound to the address it was issued to. Compared in constant time.
- 2026-10-25: Vitest resolves the `@/` alias through Vite 8's `resolve.tsconfigPaths` (`apps/web/vitest.config.mts`); tests that touch the database mock `@/lib/db`, so `pnpm --filter web test` needs no Postgres.

## Stellar service and indexer

## Smart accounts (agent passkey wallet)

## Card (Lithic ASA)

## Agent app

## Invest dashboard

## Admin panel and CPCV pipeline

## Deploy, seed and e2e
