# explorador advance: working agreement

Hackathon build of **explorador advance** (advance.explorador.ai). `spec.md` is the source of truth: follow it. Where a detail is unspecified, pick the simplest option consistent with the spec and add a line to `DECISIONS.md`. Never silently drop a feature; if something can't be done, build the closest working version and record why in `DECISIONS.md`.

## Hard rules

- **Standalone project**: own database, own API. Never modify anything outside this repo. `../irrealista` (the explorador.pt codebase) and `../explorador-house-flash-loan` are read-only inspiration: copy/adapt code from them into this repo, never edit them.
- Stellar **testnet** only. Use Stellar terms (SEP-41/50/56, Soroban, stroops); never EVM/ERC terminology in code or UI.
- English-only UI. The product name is always lowercase: "explorador advance".
- Never commit secrets: `.env*` files are gitignored except `.env.example`.

## Layout

```
apps/web/                 Next.js 16.4 app: UI + app/api/** route handlers + Lithic ASA responder
  app/                    pages (§10) and app/api/** (§9.7)
  components/             UI; design system ported from ../irrealista/web-public
  lib/env.ts              typed env access (zod); never read process.env directly elsewhere
  lib/units.ts            stroops/cents/day conversions + protocol constants
  lib/json.ts             bigint-safe JSON helpers for API responses
  lib/types/chain.ts      normalized on-chain types (bigint amounts)            ┐ shared contracts:
  lib/types/api.ts        JSON request/response types for every API route       ┘ extend additively
  lib/{stellar,zk,lithic,auth,db,crypto,format,indexer}/
  prisma/schema.prisma    spec §9.1
  zk/                     committed circuit artifacts (wasm, zkey, verification_key.json)
packages/contracts-ts/    generated TS bindings (`stellar contract bindings typescript`)
contracts/                Cargo workspace: shared/, teurc/, cpcv_note/, advance_pool/
circuits/                 circom circuit, build.sh, tests (@advance/circuits)
scripts/                  @advance/scripts (tsx): keys, deploy, seed, demo reset, lithic enroll, indexer, e2e
deployments/testnet.json  contract ids + wasm hashes (written by deploy)
```

## Units and time

- On-chain amounts: i128 **stroops** of tEURC (7 decimals). Off-chain and circuit amounts: **EUR cents**. `stroops = cents × 100_000` (`lib/units.ts`).
- JSON APIs send amounts as **decimal strings of stroops**; UI formats them with `lib/format`.
- Days = `floor(unix_seconds / 86400)` UTC. The protocol clock (`advance_pool.protocol_now()`) = ledger time + demo offset; use it for deals, interest and grace periods.
- Formatting: `€3,750.00` (en-GB), dates `14 Jan 2027`, times Europe/Lisbon, addresses `CDLZ…4XQA`.

## Next.js 16.4

This Next.js version has breaking changes vs. older training data (see `apps/web/AGENTS.md`). Before writing routing, caching, proxy/middleware, `after()`, route segment config or font code, read the relevant guide in `apps/web/node_modules/next/dist/docs/`. Heed deprecation notices.

## Commands

```
pnpm install                        # from repo root
pnpm db:up                          # Postgres 16 on localhost:5433 (docker compose)
pnpm dev                            # Next.js on http://localhost:3000
pnpm --filter web typecheck|lint|test
TEST_DATABASE_URL=postgresql://advance:advance@localhost:5433/advance_test pnpm --filter web test   # + DB-backed tests
cd contracts && cargo test          # contract tests
pnpm contracts:build                # stellar contract build (wasm32v1-none)
pnpm circuits:build                 # circom + local trusted setup → apps/web/zk
```

Env for the web app and scripts lives in `apps/web/.env.local` (template: `apps/web/.env.example`).

## Commits

- Commit early and often: one focused commit per feature or fix, Conventional Commits (`feat(pool): …`, `fix(web): …`, `test(note): …`, `chore: …`, `docs: …`).
- Stage only files you changed (`git add <paths>`); never commit `.env*`, `target/`, `node_modules/`, `.next/`.
- End every commit message with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't push, don't rewrite history, don't switch branches in someone else's checkout.
