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

- 2026-10-25: **Account contract = the OpenZeppelin smart account smart-account-kit 0.8.0 deploys on testnet** (account WASM `1b5f4534…785a`, WebAuthn verifier `CC7EKIHQ…OM3F`, Ed25519 verifier `CAAVTMCB…HKN4`; built from OpenZeppelin/stellar-contracts@1e513890, the revision the kit targets). No custom contract in `contracts/`: the kit's contracts work on today's testnet (protocol 29). We don't compile the `stellar-accounts` 0.8.0 crate: it changed the signed digest (`sha256(XDR(AuthDigestPreimage{account, payload, rule_ids}))`), so it is not what the kit or its verifiers expect. Ids are overridable with `SMART_ACCOUNT_WASM_HASH`, `WEBAUTHN_VERIFIER_ID`, `ED25519_VERIFIER_ID`.
- 2026-10-25: **stellar-sdk stays at 17.4.0; smart-account-kit is not imported at runtime.** Kit 0.8.0 requires SDK 16.3, and SDK 17 replaced the whole XDR layer (immutable classes) and the auth API, so the kit can't run on 17 and downgrading would break every other workstream. The server reimplements the kit's small auth encoding on SDK 17 (`lib/stellar/agent-tx-auth.ts`: `auth_digest = sha256(signature_payload ‖ XDR(Vec<u32> rule_ids))`, `AuthPayload`, `WebAuthnSigData`, signer key data), verified against the live contracts by `pnpm --filter @advance/scripts smoke:smart-account`. The `smart-account-kit` package stays in `apps/web/package.json` unused (peer warning only); safe to remove at merge.
- 2026-10-25: **One passkey, created by our own WebAuthn registration** (`@simplewebauthn/server`, ES256 only, discoverable, user verification required). Its COSE key → 65-byte P-256 key becomes the account's only signer `External(WebAuthn verifier, P-256 key ‖ credential id)` (rule 0, no policies). The kit never creates credentials, so there is no second registration path.
- 2026-10-25: **The sponsor deploys every agent account and is the source/fee payer of every agent transaction**; it only signs the envelope. Account address = `f(sponsor, salt)` with salt = `sha256(credential id)` (kit convention) or `sha256(demo public key)`, so deployment is deterministic and idempotent: provisioning can be retried safely and an existing account is detected instead of redeployed.
- 2026-10-25: **Seed agents' demo signer** = Ed25519 key with seed `HMAC-SHA256(DEMO_SIGNER_SEED, "explorador-advance/demo-signer/v1/" + lowercase(label))`; the label is the agent's email. Falls back to `SPONSOR_SECRET` as the HMAC key when `DEMO_SIGNER_SEED` is unset (one less key for `keys:generate`).
- 2026-10-25: Smart-account signatures expire **360 ledgers (~30 min)** after the transaction is prepared; every auth context uses context rule **0** (the constructor's Default rule). Passkey DER signatures are converted to compact r‖s and normalized to **low-S** server-side (Soroban's `secp256r1_verify` rejects high S).
- 2026-10-25: Sponsor transactions are serialized with an **in-process queue plus retry on `txBadSeq` / `TRY_AGAIN_LATER`** instead of a Postgres advisory lock, so the module also works from scripts without a database; archived contract state reported by simulation is restored automatically (sponsor pays).
- 2026-10-25: Testnet reset risk: the kit's contracts live on testnet. After a reset, re-upload the account WASM (identical hash; fetch it from mainnet with `stellar contract fetch --wasm-hash 1b5f4534… --network mainnet`), redeploy both verifiers, and set the three override env vars.
- 2026-10-25: Passkey ceremonies keep the WebAuthn challenge in the session (`SessionData.challenge`), single use (cleared before verification). `register/verify` provisions agents synchronously (smart account → `Agent` row → card; `maxDuration = 60`) and returns the provisioning status in the response; a failed step is reported, not thrown, and **`POST /api/auth/passkey/provision`** retries it (idempotent). `lib/agent/provision.ts` also exports `provisionDemoAgent` for the seed.
- 2026-10-25: **agent-tx prepare/submit are stateless**: `/prepare` returns the unsigned auth entries (base64 XDR, expiration set) plus one challenge per entry (base64url auth digest); the browser signs with `startAuthentication` and sends both back. `/submit` re-simulates the server-built call and requires identical invocation trees, the agent's own account, an unexpired signature window and a passkey owned by the user; it checks type/challenge/origin/RP ID/UP+UV/signature server-side (the verifier contract skips origin and RP ID) before re-simulating in enforce mode and submitting. The request body is the `AgentTxAction` fields at top level (`{ action: "enable_card" }`), as spec §9.3 writes it.
- 2026-10-25: Seed agents (demo signer) can use the same endpoints without a passkey: `/prepare` answers `signerKind: "demo-ed25519"` with no challenges and `/submit` signs server-side with the key derived from the agent's email (refused if the account wasn't derived from it).
- 2026-10-25: Only the passkey that created the account is its on-chain signer. Extra passkeys (e.g. a second device) can sign in but can't sign agent transactions; `/prepare` limits `allowCredentials` to the controlling passkey (recognized by re-deriving the account address). Adding signers is out of scope.
- 2026-10-25: Client side lives in `components/passkey/`: framework-free `client.ts` (`registerPasskey`, `signInWithPasskey`, `retryProvisioning`, `signAndSubmitAgentAction(action, onPhase)`), hooks (`usePasskeyRegistration`, `usePasskeySignIn`, `useProvisioningRetry`, `useAgentAction` with prepare → sign → submit phases, `usePasskeySupport`) and buttons styled per §10.1 (override with `className`). WebAuthn errors are mapped to plain-English messages.
- 2026-10-25: **Testnet fees are inflated** (protocol 29, live Soroban state above the 4 GB target, rent growth factor 5000): deploying an agent account costs ~25–30 XLM, the first action after deployment ~50–60 XLM (TTL extension of the account's instance and code), later actions ~0.01 XLM. A Friendbot-funded sponsor (10,000 XLM) covers roughly 100 agent onboardings; give it a fresh Friendbot account (merged in) when it runs low.
- 2026-10-25: Note for deploy: **WASM uploads currently cost ≥ 450 XLM** (1 KB → 472 XLM, 10 KB → 657 XLM), above the ~429 XLM uint32 per-transaction fee cap, so a plain upload transaction can't be built. Wrapping it in a **fee-bump transaction** works (int64 outer fee): build the inner upload with a placeholder `resourceFee`, swap in the simulated `SorobanTransactionData`, sign, then `TransactionBuilder.buildFeeBumpTransaction` (verified on testnet, upload tx `cda18111…5a93`). Sponsored agent transactions use the same fallback automatically (`sponsorEnvelope` in `lib/stellar/agent-tx-sponsor.ts`), e.g. when an invocation must restore archived contract code.
- 2026-10-25: Node gives each resolved address only 250 ms to connect; on slow links every attempt to the RPC fails with `fetch failed`. The smoke script raises it (`net.setDefaultAutoSelectFamilyAttemptTimeout`); run the dev server with `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000` in that case.

## Card (Lithic ASA)

## Agent app

## Invest dashboard

## Admin panel and CPCV pipeline

## Deploy, seed and e2e
