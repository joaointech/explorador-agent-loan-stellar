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

- 2026-10-25: **`advance_pool.open_line` takes the note by value** (`fn open_line(env, note: Note)`), not `note_id` (deviation from spec §7.2 step 10 / §7.3). Soroban prohibits contract re-entry (soroban-env-host 28 calls every external contract with `ContractReentryMode::Prohibited` → "Contract re-entry is not allowed"), so `cpcv_note.mint → advance_pool.open_line → cpcv_note.get` would trap. `mint` passes the stored `Note`; the pool authenticates with `note_contract.require_auth()` (satisfied because `cpcv_note` is the direct invoker). Agreed with the orchestrator and the pool workstream.
- 2026-10-25: **G2 byte order** (spec §8.5 "do not guess"): soroban-sdk 28 `Bn254G2Affine` uses the Ethereum EIP-197 encoding `be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0)` (imaginary part first); soroban-env-host 28 decodes it by reversing each 64-byte Fp2 into arkworks' little-endian `c0 ‖ c1`. snarkjs JSON lists `[c0, c1]`, so `lib/zk/format.ts` swaps the halves. Confirmed by the Rust test verifying real snarkjs proofs, and by `vk.gamma` encoding to the well-known EIP-197 G2 generator bytes (`198e9393…`).
- 2026-10-25: Trusted setup is a **local single-contributor ceremony** (`powersoftau new bn128 15` + one contribution, `groth16 setup` + one `zkey contribute`, random entropy from `/dev/urandom`, `zkey verify`): fine for a testnet demo, but whoever ran `build.sh` could forge proofs if they kept the entropy. Every `pnpm circuits:build` is a new setup: commit the new `apps/web/zk/*` + fixture and redeploy `cpcv_note` with the new `verification_key.soroban.json`.
- 2026-10-25: `property_hash` = `Poseidon(len_bytes, chunk_0 … chunk_7)` in **one 9-input call**: circomlib/circomlibjs Poseidon takes up to 16 inputs, so arity does not require the two-call split. Normalization adds Unicode **NFC** before lowercasing (Portuguese addresses may arrive composed or decomposed); chunks are 31-byte big-endian integers, the last one zero-padded on the right; addresses over 248 UTF-8 bytes are rejected.
- 2026-10-25: The verifier rejects **non-canonical public inputs (≥ r)**: `Bn254Fr::from_bytes` reduces mod r, so `nullifier + r` would verify as the same field element while passing the byte-keyed `NullifierUsed`/`CommitmentUsed` checks (double financing). Malformed points (off-curve G1/G2, G2 outside the subgroup) trap in the host instead of returning `false`; well-formed wrong proofs return `false` → `Error::InvalidProof`.
- 2026-10-25: Circuit details: `commission_rate_bps` is bounded to 10 bits (`Num2Bits(10)`, 1000 < 2^10) before the `GreaterEqThan(10)`/`LessEqThan(10)` comparators so they are sound; `rem` is bounded by `Num2Bits(14)` + `LessThan(14)`; `odd` and `rem` are prover hints (`<--`) pinned by constraints. 11,716 constraints (9,000 non-linear), default circom optimization (`--O1`). NIFs are not range-checked (not required by §8.3).
- 2026-10-25: The Rust fixture lives at `contracts/shared/fixtures/groth16_fixture.rs` (generated by `scripts/vk-to-soroban.ts`, included with `include!` by the shared and cpcv_note tests) rather than `circuits/test/` (spec §6): it is Rust code consumed only by the contract crates. It holds three real proofs (fixed TEST keys; two agents, one odd total) so tests can mint several notes.
- 2026-10-25: Circuit tests use Node's built-in `node:test` (no extra dependency) with an independent JS re-implementation of the input encoding; each violated constraint is pinned to its source line via the witness calculator's assertion message.
- 2026-10-25: `cpcv_note` ids start at **1** (`count()` = ids minted); `list(start, limit)` returns notes with id ≥ `start` in id order (so `start` 0 and 1 both mean "from the first"; next page = last id + 1) and silently caps `limit` at 50.
- 2026-10-25: `cpcv_note` storage additions: persistent `AgentNotes(Address) → Vec<u32>` backs `notes_of`; `NullifierUsed`/`CommitmentUsed` store the id of the note that used them. OpenZeppelin's `Owner(id)`/`Balance(agent)` entries are extended to the 90-day persistent TTL at mint (OZ only extends them to 30 days on reads). `minted_at` = `pool.protocol_now()` at mint.
- 2026-10-25: `token_uri = base_uri + "/" + id` via OpenZeppelin's `Base::token_uri` with its metadata `base_uri` set to `base_uri + "/"` (unless it already ends with "/"); `base_uri` must be < 200 bytes (OZ limit including the separator). The raw `base_uri` is also kept in instance storage as listed in spec §7.2.
- 2026-10-25: `cpcv_note` extras beyond spec §7.2 (additive): view `attester_params() → { attester_ax, attester_ay, nullifier_secret_commitment }` so anyone can rebuild public inputs 6–8 from chain data (`lib/zk/public-signals.ts`); `mint` rejects `total_commission_cents == 0` with `InvalidAmount`; the constructor rejects a VK whose `ic` is not 10 points or non-canonical attester parameters (`InvalidProof`). `set_status` does not police transitions (the pool owns the line state machine).
- 2026-10-25: Soulbound: the OZ `NonFungibleToken` trait methods return `()`, so `transfer`/`transfer_from`/`approve`/`approve_for_all` fail via `panic_with_error!(Error::Soulbound)` (clients see contract error #17). OZ's standard `mint` event is emitted alongside `note_minted`.
- 2026-10-25: Costs (soroban-sdk 28 test budget): `groth16::verify` = 34,914,918 CPU instructions / 203 KB; `cpcv_note.mint` = 35.6M native, **36,677,412 with the optimized wasm** (23,268 bytes) and a native mock pool. Testnet limit (protocol 29, read 2026-10-25): 400M instructions and 40 MiB per transaction, so a mint uses ~9%. Uses `g1_mul`/`g1_add` per spec; `g1_msm` (protocol 26) would be cheaper if ever needed.
- 2026-10-25: `lib/zk` layout: `field`/`format`/`agent-field`/`public-signals` are browser-safe (no Node built-ins, no `Buffer`) for the registry's in-browser verification (`verify.ts` → `verifyNoteProof`); `poseidon`/`keys`/`attestation`/`prove`/`artifacts` are server-side without `server-only` (tsx scripts import them). `proveCpcv` keeps the stub signature; `proveCpcvWithKeys(agent, input, keys, onStep?, { salt? })` takes explicit keys for scripts and tests. Invalid input throws `CpcvInputError` (`status` 400, `code` INVALID_*), not `HttpError`: `lib/http` imports through the `@/` alias, which Vitest cannot resolve without a config, so `lib/zk` value imports are relative and Vitest runs without a `vitest.config.ts`.
- 2026-10-25: Artifact lookup is `process.cwd()`-relative (`zk/` for Next.js/Vitest/Vercel, `../apps/web/zk` for scripts, `ZK_ARTIFACTS_DIR` override); the Next.js candidate is statically scoped (`path.join(process.cwd(), "zk")`) and the script-only candidates carry `turbopackIgnore`, so `next build` traces exactly `apps/web/zk/**` into the route (checked in `route.js.nft.json`) instead of the whole project. Verified with a throwaway route handler under Next.js 16.4 `next dev` (Turbopack) and `next build` + `next start`: no `serverExternalPackages` needed; proofs 0.9 s cold / 0.37–0.46 s warm on an Apple-silicon laptop. Adding `outputFileTracingIncludes: { "/api/admin/cpcv": ["./zk/**"] }` (spec §8.6) remains a harmless belt-and-braces for the route owner.
- 2026-10-25: snarkjs keeps a cached multi-threaded curve (`globalThis.curve_bn128`) after proving/verifying: good for warm serverless instances; tsx scripts and tests call `releaseZkResources()` so the process can exit.

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
