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
- 2026-10-25: RPC calls retry transient network errors twice (100 ms, 200 ms), never JSON-RPC or contract errors. Observed in the Next.js dev server: after an idle spell, POSTs to the testnet RPC failed with undici's "fetch failed" until the pooled sockets were replaced. Retrying is safe for every call we make: reads are idempotent, and re-sending a signed transaction is too (same hash, applied at most once; RPC answers DUPLICATE). Error messages now include undici's `cause`.
- 2026-10-25: Stellar errors are `HttpError` subclasses, so any `route()` handler maps them without extra code: contract errors become `ContractError` with the shared numbering as SCREAMING_SNAKE codes (`DUPLICATE_DRAW`, `GRACE_NOT_OVER`; 404 for `UNKNOWN_NOTE`, 403 `NOT_AUTHORIZED`, 400 for bad input, else 409); `NOT_DEPLOYED`/`CONTRACT_MISSING`/`NOT_CONFIGURED` are 503, RPC trouble 502/504. `isContractError(err, "DuplicateDraw")` helps callers branch.
- 2026-10-25: Deployment lookup: newest active `Deployment` row for `STELLAR_NETWORK`, else `deployments/<network>.json` (searched from the cwd, `../` and `../../`, so Next.js, scripts and the repo root all find it), else `null`. Cached 5 s; `invalidateDeploymentCache()` for deploy/reset flows. On Vercel the DB row is the source of truth: the file read is marked `turbopackIgnore`, because a dynamic `readFile` path otherwise makes Turbopack trace the whole project into every serverless function.
- 2026-10-25: `lib/stellar/contracts.ts` is server-only in practice (it pulls in RPC, Prisma and `pg`), so the pure `explorerUrl` helper lives in client-safe `lib/stellar/explorer.ts` and is re-exported from `contracts.ts` with the same signature. Client components should import it from `lib/stellar/explorer`.
- 2026-10-25: Projected APY follows §5.5 in bigint stroops (`lib/pool/apy.ts`); with no senior capital the senior figure is the target (what a first depositor would earn), and junior APY is 0 when junior assets are 0. Trailing APY compares the live share price (at `protocol_now`) with the newest snapshot at least 7 protocol days old; with less history it annualizes over the oldest snapshot at least 1 protocol day old, otherwise `null`.
- 2026-10-25: The demo-clock offset has no view function, so `DemoClock.offsetSecs` is estimated as `protocol_now − wall clock`, rounded to the minute (ledger time trails the wall clock by a few seconds; the chip shows days).
- 2026-10-25: Indexer cursor per deployment: `IndexerCursor.id = "events:<teurc>:<cpcvNote>:<advancePool>"`, so a demo reset starts a fresh scan. The first pass scans the whole RPC retention window (testnet: 120,960 ledgers ≈ 7 days; one `getEvents` call scans at most 10,000 ledgers, so ~13 pages, a few seconds); later passes resume at the last scanned ledger (inclusive, deduplicated on `txHash + eventIdx`) and page until the RPC's latest ledger. Ledgers that aged out of retention are reported as a `gap` and skipped; a cursor past the chain tip (testnet reset) rescans the retention window.
- 2026-10-25: All events of the three contracts are stored, including SEP-41/SEP-50 token events (`Transfer`, `Mint`, `Burn`, `Approve`). `ChainEvent.type` is the PascalCase event name (`NoteMinted`, `CardDraw`, `Deposit`, …); `data` holds camelCase fields (64/128-bit integers as decimal strings, u32 as numbers, bytes as hex, enum variants as strings; a `None` Option is absent, per sparse event maps) plus `ledgerClosedAt` (ISO, real time). Event schemas separate topic fields from data fields, so Stellar Asset Contract layouts (extra SEP-11 asset topic, i.e. real EURC swapped in) decode correctly too.
- 2026-10-25: `ChainEvent.protocolTs` = ledger close time + the demo offset in effect. Each `ClockAdvanced { secs, protocol_now }` pins the offset exactly (after = protocol_now − close time, before = after − secs); with no anchor known, the current offset (`protocol_now − latest close time`) is used.
- 2026-10-25: Reconciliation from events moves rows forward only: `Cpcv` → MINTED (matched by commitment, also linking `noteId`/`mintTxHash`), SETTLED / CANCELLED (by note id **and** the agent's smart account, so a stale row of an older deployment is never touched), WRITTEN_OFF (the agent's cancelled CPCVs that carried debt). As safety nets for the request-path writers it also mirrors `CardEnabled` into `Agent.cardEnabledOnChain` and confirms `CardAuthorization` rows whose `sha256(lithicToken)` equals the draw's `auth_ref`.
- 2026-10-25: Sync-on-read: `syncIfStale(10_000)` is single-flight per process and waits at most 4 s (a slow pass finishes in the background); failures are logged, never thrown into the read. Snapshot attempts back off for a minute after a failure. `recordPoolSnapshot({ force: true })` is available for the seed script to capture history between clock fast-forwards. `/api/cron/sync` is public (idempotent, read-only towards the chain).
- 2026-10-25: Public read routes are thin wrappers over `lib/` read models (`lib/indexer/registry.ts`, `lib/pool/stats.ts`, `lib/pool/investor.ts`) so pages can call the same functions server-side. GET handlers are `force-dynamic`; public/investor routes call `syncIfStale()` first. A shared 3 s cache of `stats()` keeps one simulation per page load. Without a deployment: `/api/config` returns `deployment: null`, `/api/registry` an empty list, `/api/pool/snapshots` no points, `/api/cron/sync` `skipped`; the others answer 503 `NOT_DEPLOYED`. Contract ids without contracts (testnet reset) give 503 `CONTRACT_MISSING`.
- 2026-10-25: Registry list: newest first, `cursor` = id of the last note of the previous page, `limit` 25 by default (max 100). `status` accepts any case/punctuation (`WrittenOff`, `written-off`, `all`); `q` matches a note id (`12`, `#12`) or an agent address (full, partial, or truncated `CDLZ…4XQA`). `counts` cover all notes, unfiltered. `creditLimit` comes from `LineOpened` (else `agent_commission × ltv_bps`), `mintTxHash` from `NoteMinted` (else the Cpcv row), `overdue` = Active and protocol day > escritura day. "WrittenOff" = a note cancelled with carried debt followed by a `DebtWrittenOff` of the same agent (or its Cpcv row says WRITTEN_OFF).
- 2026-10-25: Registry detail: `snarkjsProof` + `publicSignals` come from `Cpcv.proof` (`{ proof, publicSignals }`) only when the row's commitment equals the note's (guards against rows of an older deployment). Otherwise the proof is derived from the on-chain bytes (un-negated A, CAP-74 G2 order `X.c1‖X.c0‖Y.c1‖Y.c0`) and the signals are rebuilt from chain data, taking signals 6–8 (attester key, nullifier-secret commitment, contract constants without a view) from any stored proof; `[]` if none exists. Cpcv queries select public columns only.
- 2026-10-25: `CardDraw` events don't name the line, so registry draws are attributed by replaying the contract's rule (lines open at the draw, earliest escritura first, up to each credit limit, principal only). `draws.total` uses exact figures where they exist: `debt_repaid − interest_paid` for settled notes, `line(note).principal` for active ones; attribution otherwise. The timeline lists NoteMinted, LineOpened, the attributed CardDraws (with `attributedToNote`), NoteSettled/NoteCancelled and, for written-off notes, the DebtWrittenOff; `at` is the protocol timestamp.
- 2026-10-25: SEP-50 metadata (`/api/registry/[id]/metadata`): `name`, `description`, `image` (`APP_URL/logo.svg`), `external_url` (`APP_URL/registry/<id>`) and `attributes` (status, agent address, EUR amounts as numbers, escritura date, mint date, commitment, nullifier). No PII.
- 2026-10-25: Snapshot series: windows are relative to the newest snapshot's protocol time (`7d`, `30d`, `all`), one point per protocol timestamp, at most 500 points (even downsampling), and only snapshots created after the active `Deployment` row (a demo reset starts a new history).
- 2026-10-25: Investor position: `value` = §5.5 `convert_to_assets(shares)` on the cached stats; `deposited` = Σ `Deposit.assets` where `receiver` is the address, `withdrawn` = Σ `Withdraw.assets` where `owner` is the address, `earned = value + withdrawn − deposited`; history newest first. Shares moved by eaSR transfers are not counted as deposits.
- 2026-10-25: `POST /api/faucet/teurc` sends 10,000 tEURC, operator-signed, and allows one grant per address per minute (in-memory per server instance, plus an in-flight guard against double clicks).
- 2026-10-25: `scripts/indexer.ts` loads `apps/web/.env.local` with Node's `process.loadEnvFile` (no dotenv dependency in scripts) before dynamically importing lib modules, because `lib/db` reads `DATABASE_URL` at import time. Note for scripts: tsx loads `apps/web/lib/**` as CommonJS (that package has no `"type": "module"`) but `scripts/*.ts` as ESM, so SDK objects built in a script and handed to lib/stellar (e.g. a `Transaction` for `submitAndPoll`) must come from the same module instance (`createRequire`), or let lib/stellar build them.

## Smart accounts (agent passkey wallet)

## Card (Lithic ASA)

## Agent app

## Invest dashboard

## Admin panel and CPCV pipeline

## Deploy, seed and e2e
