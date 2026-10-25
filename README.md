# explorador advance

**Close the deal. Get paid today.**

explorador advance lets [explorador](https://explorador.pt)'s real-estate agents spend part of their future commission by card on the day the CPCV (promissory purchase contract) is signed, months before the escritura (deed) pays it. Investors fund those advances through a pooled senior vault on Stellar and earn the interest agents pay. explorador's own first-loss capital stands in front of them.

Hackathon build. **Stellar testnet only.** Lives at `advance.explorador.ai`.

| | |
|---|---|
| Specification | [`spec.md`](./spec.md) |
| What was actually built, and why | [`DECISIONS.md`](./DECISIONS.md) |
| Acceptance checklist with evidence | [`ACCEPTANCE.md`](./ACCEPTANCE.md) |
| Contracts, API routes, events, errors | [`docs/reference.md`](./docs/reference.md) |

## Contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Live testnet deployment](#live-testnet-deployment)
- [Prerequisites](#prerequisites)
- [Setup from a fresh clone](#setup-from-a-fresh-clone)
- [Signing in to the demo](#signing-in-to-the-demo)
- [Card payments: Lithic sandbox or the simulated network](#card-payments-lithic-sandbox-or-the-simulated-network)
- [Deploying to Vercel + Neon](#deploying-to-vercel--neon)
- [Testing](#testing)
- [5-minute demo script](#5-minute-demo-script)
- [Trust model](#trust-model)
- [Security notes](#security-notes)
- [Testnet caveats](#testnet-caveats)
- [Path to production](#path-to-production)
- [Credits](#credits)

## How it works

An agent closes a deal when buyer and seller sign the CPCV, but the commission (split 50/50 between the agent and explorador) only arrives at the escritura, often months later. explorador advance bridges that gap in five steps:

1. **CPCV → zero-knowledge proof.** An explorador admin enters the deal. The server encrypts the personal data in Postgres, signs an attestation with explorador's attester key and generates a Groth16 proof. The proof reveals the commission and the agent; it hides the buyer, the seller, their NIFs, the sale price, the commission rate, the property and the CPCV date.
2. **Proof verified on-chain → CPCV Note.** `cpcv_note.mint` verifies the proof on Soroban (BN254 pairing host functions) and mints a soulbound **CPCV Note** (SEP-50) to the agent's passkey smart account. It records the note in a public registry and opens a credit line of 50% of the agent's commission in `advance_pool`.
3. **The agent pays by card.** A purchase reaches the Auth Stream Access (ASA) responder, which approves or declines in well under 2 s from on-chain state (a live read within 1.2 s, else the cached position). Right after responding, the server records `card_draw` on-chain. The draw spends the agent's card balance first, then borrows tEURC against their notes (earliest escritura first) and pays it to the card-settlement account. The agent never sees a wallet, a seed phrase or a fee.
4. **Investors fund the pool.** Investors deposit tEURC with Freighter into the senior vault (SEP-56, share token `eaSR`). Interest flows to the senior tranche first, up to an 8% target APY; explorador's junior tranche gets the rest and absorbs losses first.
5. **Escritura → settlement.** The operator and treasury sign `advance_pool.settle`. The pool pulls the full commission from the treasury and repays the note's debt plus interest (and any carried debt). The rest of the agent's half goes to their card balance and explorador's half tops up the junior tranche. If the buyer walks away instead, `cancel` moves the debt onto the agent as carried debt with a 180-day grace period. After that, `write_off` takes the loss from junior first, then senior.

Fixed parameters (spec §5.1): LTV 50% of the agent's half, 12% APR on the drawn balance, 10% of interest to explorador, 8% senior target, 10,000 tEURC junior seed, total debt ≤ 10 × junior assets.

### Worked example (spec §5.6)

| Step | Amount |
|---|---|
| Sale price €300,000 at 5% | total commission **€15,000**; agent €7,500, explorador €7,500 |
| Credit limit (50% of the agent's half) | **€3,750** |
| Agent spends on day 0 | €3,000 |
| Escritura on day 90 (one accrual) | interest €3,000 × 12% × 90/365 = **€88.77**; protocol fee €8.88; €79.89 to the tranches |
| Settlement | debt €3,088.77 repaid; **€4,411.23** to the agent's card balance; **€7,500** to the junior tranche |

With daily pool activity the interest compounds to about €90.08 instead. The contract tests and `pnpm e2e` reproduce the single-accrual figures to the cent. Debts round up, so junior actually receives €7,500 plus 1 stroop of rounding surplus.

Yield illustration (senior €100,000, junior €10,000): with €60,000 of debt, net interest of €6,480 a year all goes to senior (**6.48%**, junior 0%). With €90,000 of debt, senior gets the **8.00%** target and junior the remaining €1,720 (**17.2%**). Loss illustration: writing off €2,000 of carried debt takes junior from €10,000 to €8,000 and leaves senior untouched.

## Architecture

```mermaid
flowchart LR
  subgraph people["People"]
    agentU["Agent on a phone<br/>email code + passkey"]
    adminU["explorador admin<br/>email code + passkey"]
    investorU["Investor<br/>Freighter wallet"]
  end

  subgraph app["Next.js 16 app · apps/web · Vercel"]
    pages["Pages<br/>/ · /agent · /invest · /admin · /registry"]
    api["API routes<br/>auth · agent · admin · pool · registry"]
    pipeline["CPCV pipeline<br/>EdDSA attestation · Groth16 proof with snarkjs"]
    asa["ASA responder<br/>POST /api/lithic/asa · decides in under 2 s"]
    indexer["Indexer<br/>sync-on-read · /api/cron/sync"]
  end

  pg[("Postgres · Neon or Docker<br/>users · passkeys · encrypted CPCV data<br/>card authorizations · chain events · snapshots")]

  subgraph cards["Card network"]
    lithic["Lithic sandbox<br/>Auth Stream Access"]
    simnet["Simulated network<br/>when LITHIC_API_KEY is unset"]
  end

  subgraph stellar["Stellar testnet · Soroban"]
    teurc["teurc<br/>SEP-41 test EURC"]
    notec["cpcv_note<br/>SEP-50 soulbound notes · public registry<br/>Groth16 verifier on BN254 host functions"]
    pool["advance_pool<br/>SEP-56 senior vault · eaSR shares · junior tranche<br/>credit lines · card draws · settlement"]
    sa["Agent smart accounts<br/>OpenZeppelin · WebAuthn P-256 signer<br/>deployed and fee-paid by the sponsor"]
  end

  circuit["circuits/cpcv_attestation.circom<br/>local trusted setup → apps/web/zk"]

  agentU --> pages
  adminU --> pages
  investorU --> pages
  pages --> api
  api <--> pg
  circuit -.->|"wasm + zkey"| pipeline
  circuit -.->|"verification key, at deploy"| notec
  api --> pipeline
  pipeline -->|"mint: proof verified on-chain"| notec
  notec -->|"open_line"| pool
  api -->|"simulate purchase"| lithic
  api -->|"simulate purchase"| simnet
  lithic -->|"ASA request"| asa
  simnet -->|"same request, in-process"| asa
  asa <--> pg
  asa -->|"card_draw as operator, after responding"| pool
  api -->|"sponsor submits passkey-signed enable_card, withdraw_balance"| sa
  sa -->|"authorizes"| pool
  investorU -->|"deposit, withdraw: built in the browser, signed in Freighter"| pool
  pool <--> teurc
  indexer -->|"getEvents"| pool
  indexer --> pg
```

- **Live state** comes straight from the contracts through RPC simulation of view functions: balances, debt, credit, pool stats and notes.
- **History** comes from Postgres: card authorizations, deposits, settlements and events. The indexer fills it from Soroban `getEvents`. It runs as sync-on-read: public, agent and investor routes sync when the data is over 10 s old. It also runs from `/api/cron/sync`, and as a long-running loop locally with `pnpm indexer`.
- **Private data** (CPCV personal data) lives only in Postgres, AES-256-GCM encrypted, decrypted for admins only. It never goes on-chain.
- **Contract ids** come from the active `Deployment` row in Postgres, falling back to `deployments/testnet.json`, so a demo reset needs no env change. On Vercel the database row is the only source.
- **Units:** on-chain amounts are i128 stroops of tEURC (7 decimals); off-chain and in-circuit amounts are EUR cents (`stroops = cents × 100,000`). Time-dependent logic uses the protocol clock, `advance_pool.protocol_now()` = ledger time + a demo offset that only the admin can move forward.

On-chain roles, each a separate config value even when the demo reuses an account:

| Role | Env var | Signs |
|---|---|---|
| admin | `ADMIN_SECRET` | deploys and wiring, `advance_clock` (demo only) |
| operator | `OPERATOR_SECRET` | `cpcv_note.mint`, `card_draw`, `settle`, `cancel`, `write_off`, `set_blocked`; the faucet fallback |
| treasury | `TREASURY_SECRET` | pays commissions at `settle`; owns the junior tranche; claims protocol fees |
| card settlement | `CARD_SETTLEMENT_PUBLIC` | nothing: receives the tEURC of every card spend |
| sponsor | `SPONSOR_SECRET` | deploys agent smart accounts; source and fee payer of agent transactions |
| attester | `ATTESTER_EDDSA_PRIVKEY` | off-chain BabyJubJub key that signs CPCV attestations for the circuit |

## Repository layout

```
apps/web/                 Next.js 16.4 app: pages, app/api/** route handlers, Lithic ASA responder
  app/                    / · /agent · /invest · /admin/** · /registry/** · /login · previews · /design
  components/             UI, design system ported from explorador.pt
  lib/                    env, stellar, zk, lithic, card, auth, passkey, db, crypto, indexer, pool, wallet, admin, demo
  prisma/                 schema.prisma (spec §9.1) + migrations
  zk/                     committed circuit artifacts: wasm, zkey, verification keys
  vercel.json             cron jobs for Vercel
contracts/                Cargo workspace (Rust 1.94, soroban-sdk 28, target wasm32v1-none)
  teurc/                  SEP-41 test EURC with an open faucet
  cpcv_note/              SEP-50 soulbound note, public registry, Groth16 verifier
  advance_pool/           SEP-56 senior vault (eaSR), junior tranche, credit lines, settlement
  shared/                 types, errors, mul-div math, Groth16 verifier, proof fixtures
  integration_tests/      the three contracts wired together, native and optimized wasm
circuits/                 cpcv_attestation.circom, build.sh (local trusted setup), circuit tests
scripts/                  keys:generate, deploy:testnet, seed, demo:reset, e2e, lithic:enroll, indexer, ttl, fund
packages/contracts-ts/    TypeScript bindings generated from the wasm (reference only, not built)
deployments/testnet.json  contract ids, wasm hashes, roles and tx hashes of the active deployment
docs/reference.md         contract interface, API routes, events and error codes
docker-compose.yml        Postgres 16 for local development (host port 5433)
```

## Live testnet deployment

Recorded in [`deployments/testnet.json`](./deployments/testnet.json): deployed 25 Oct 2026 by `pnpm demo:reset`, `DEMO_MODE` on.

| Contract | Id |
|---|---|
| `teurc` (tEURC, SEP-41) | [`CBQAP2CNY2ZY54PS74HAPSS2MVHZNIHWFC3CZQLK6TKTYPW4IB6OIULF`](https://stellar.expert/explorer/testnet/contract/CBQAP2CNY2ZY54PS74HAPSS2MVHZNIHWFC3CZQLK6TKTYPW4IB6OIULF) |
| `cpcv_note` (eaNOTE, SEP-50) | [`CA4DEKS56LV6BNKBIKXGCCYDQ2BJEV7OTI73OBNJRCA6SGUEJARHXINV`](https://stellar.expert/explorer/testnet/contract/CA4DEKS56LV6BNKBIKXGCCYDQ2BJEV7OTI73OBNJRCA6SGUEJARHXINV) |
| `advance_pool` (eaSR, SEP-56) | [`CBZGR3MQFKWSLW6VS4BHOJ6FC3EKKJ2OZ47SU4XTE7GYVPPEAAFOEMNU`](https://stellar.expert/explorer/testnet/contract/CBZGR3MQFKWSLW6VS4BHOJ6FC3EKKJ2OZ47SU4XTE7GYVPPEAAFOEMNU) |

The wasm hashes (`teurc` `761716af…72e6`, `cpcv_note` `a52f94d1…2565`, `advance_pool` `299d6e9f…76e3`) match a local `pnpm contracts:build` of this source byte for byte. Roles: admin [`GADM…3RWW`](https://stellar.expert/explorer/testnet/account/GADMCAK3SSHGRAL7JS3XUQID7UZLAY4A57UR4W5VOY7TKTNARVHB3RWW), operator [`GDLV…KQYT`](https://stellar.expert/explorer/testnet/account/GDLVQ5V5OZ4TGYHJGESUR5X4YAPBILXJSMALA56MILPJYBGS7XRBKQYT), treasury [`GBDC…LI5K`](https://stellar.expert/explorer/testnet/account/GBDCCBA6CRR5VYZ7YLCSIZKMOOPOJ5MWT36RG23A5HMX5LJIUH5YLI5K), card settlement [`GAHT…O2ZP`](https://stellar.expert/explorer/testnet/account/GAHT6VRCGSMA7DVPINHXD7K4KYKVYI246ZKPRIL4B6LVKTNGLYGSO2ZP).

Seeded state, read from the chain on 25 Oct 2026 at 17:50 UTC:

| Note | Agent | Total commission | Agent's half | Credit limit | Status | Mint (on-chain proof verification) |
|---|---|---|---|---|---|---|
| #1 | `CAJH…SPSP` | €24,250.00 | €12,125.00 | €6,062.50 | Active | [`b41bc9c1…`](https://stellar.expert/explorer/testnet/tx/b41bc9c1f5811ebc00957de8f770073ba523d4a715993ab7a4a851f3ee9d91b8) |
| #2 | `CCKC…Z53Z` | €14,040.00 | €7,020.00 | €3,510.00 | Settled | [`54d4766c…`](https://stellar.expert/explorer/testnet/tx/54d4766c1c3e98ec66afb14e746021607c88bce0e998a5e5deb0065af48e76c1) |
| #3 | `CAJH…SPSP` | €24,800.00 | €12,400.00 | €6,200.00 | Settled | [`4c97218d…`](https://stellar.expert/explorer/testnet/tx/4c97218d15418295ac0073bfa50c41f3670545fcf1684af6a1dd656fde769c1f) |
| #4 | `CDEY…QHW4` | €9,250.00 | €4,625.00 | €2,312.50 | Cancelled, carried debt in grace | [`0b58d87e…`](https://stellar.expert/explorer/testnet/tx/0b58d87e04901c2d569df22a499b88f19584405e8023332275319485a8212a07) |
| #5 | `CDEY…QHW4` | €19,750.00 | €9,875.00 | €4,937.50 | Active | [`26ad9d00…`](https://stellar.expert/explorer/testnet/tx/26ad9d002437a53353414557527f3fb9bf450b3a731ffb357ab7794aca882b69) |

There have been 13 card draws, 2 settlements and 1 cancellation. The pool holds senior €65,198.64 on 65,000 eaSR (share price 1.003056), junior €29,420.00 and €6,168.79 of debt. The protocol clock reads 22 Feb 2027 (+120 days). [`ACCEPTANCE.md`](./ACCEPTANCE.md) lists every transaction.

Agent smart accounts use the OpenZeppelin contracts that smart-account-kit 0.8.0 deployed on testnet: account wasm `1b5f4534…785a`, WebAuthn verifier [`CC7EKIHQ…OM3F`](https://stellar.expert/explorer/testnet/contract/CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F), Ed25519 verifier [`CAAVTMCB…HKN4`](https://stellar.expert/explorer/testnet/contract/CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4).

> **`token_uri` caveat.** `cpcv_note`'s `base_uri` is fixed at deploy. This deployment was made from a development machine, so `token_uri(id)` points at `http://localhost:3112/api/notes/<id>`. The production reset described in [Deploying to Vercel + Neon](#deploying-to-vercel--neon) fixes it.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.22.1 | Pinned in `.npmrc` (`use-node-version`); pnpm downloads it and runs every script with it. |
| pnpm | 9 (`9.15.4`) | `corepack enable`, or `npm i -g pnpm@9.15.4`. |
| Rust | 1.94.0 + `wasm32v1-none` | Pinned in `contracts/rust-toolchain.toml`; rustup installs it on first use. |
| Stellar CLI | ≥ 28 (tested 28.1.0) | `stellar contract build` and the TypeScript bindings. |
| Docker | with Compose | Postgres 16 for local development. |
| circom | 2.2.3 | Only to rebuild the circuit; the artifacts are committed. snarkjs comes from the workspace. |

For the demo flows you also want the [Freighter](https://www.freighter.app) extension set to **Testnet**. A Lithic sandbox key, `cloudflared` or `ngrok`, and a Resend API key are optional.

## Setup from a fresh clone

```bash
pnpm install          # Node 24 via .npmrc; also generates the Prisma client
pnpm db:up            # Postgres 16 on localhost:5433
pnpm keys:generate    # apps/web/.env.local: role keys funded with Friendbot, attester key, secrets
pnpm db:migrate       # create the schema (prisma migrate dev)
pnpm contracts:test   # optional: ~100 contract tests (a few minutes on the first build)
pnpm deploy:testnet   # build, upload, deploy and wire the contracts; writes deployments/testnet.json
pnpm seed             # demo data: 3 agents, 2 investors, 5 CPCVs, 13 card spends over 120 protocol days
pnpm dev              # http://localhost:3000
pnpm e2e              # optional: the full flow on testnet, on its own database and contracts
```

Notes:

- **You deploy your own contracts.** The live deployment answers only to the keys that created it, and those keys are not in the repo. `pnpm deploy:testnet` rewrites `deployments/testnet.json`, so don't commit that file unless you mean to replace the live record.
- `pnpm keys:generate` never overwrites a value that is already set (use `--force` to replace). Other flags: `--app-url`, `--admin-emails`, `--database-url`, `--no-fund`. Unless you pass `--admin-emails` (or already set a real address), it sets `ADMIN_EMAILS=admin@demo.explorador.pt`, a seeded admin with no inbox whose sign-in code goes to the server console (see below). Every variable is documented in [`apps/web/.env.example`](./apps/web/.env.example).
- `pnpm seed` needs a fresh `DEMO_MODE` deployment (it refuses if any note exists). `pnpm demo:reset` redeploys from the uploaded wasm and reseeds in one go (about 165 s).
- Everything is paid in testnet XLM. Fees swing wildly on testnet (see [Testnet caveats](#testnet-caveats)). The scripts fee-bump large transactions and top up payers from Friendbot; `pnpm --filter @advance/scripts fund` tops the role accounts up on demand.
- `pnpm indexer` runs the event indexer in a loop. It is optional: the API syncs on read.
- **Rebuilding the circuit is optional.** `pnpm circuits:build` (needs circom) runs a **new** trusted setup, so the verification key changes. Commit the new `apps/web/zk/*`, `apps/web/public/zk/verification_key.json` and `contracts/shared/fixtures/groth16_fixture.rs`, then run `pnpm deploy:testnet` (fresh contracts; `cpcv_note` gets the new key) and `pnpm seed`.
- On slow networks, RPC calls from the dev server can fail with `fetch failed`. Use `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000 pnpm dev`.

## Signing in to the demo

Everyone signs in at `/login` with an email and a 6-digit code (with a passkey once they have one). Investors don't sign in at all: `/invest` works with Freighter.

| Who | How |
|---|---|
| Seed agents | `ana@demo.explorador.pt` (Ana Costa), `bruno@demo.explorador.pt` (Bruno Ferreira), `carla@demo.explorador.pt` (Carla Mendes). Demo accounts have no inbox: while `DEMO_MODE=true` their code is shown on the login page ("Use it"). Their smart accounts use a server-held Ed25519 demo signer, so they never see a passkey prompt. |
| Admin | The first address in `ADMIN_EMAILS`, created by the seed. `keys:generate` defaults to `admin@demo.explorador.pt`. That account has no inbox, and its code is shown on the login page only with `DEMO_ADMIN_SIGNIN=true`; otherwise it is printed in the server console (the `pnpm dev` output, or the Vercel logs). On a public deployment, use a real address and Resend. |
| New agents | Any other email. The code goes out through Resend, or to the server console when `RESEND_API_KEY` is unset. Then: create one passkey → the sponsor deploys the agent's smart account and a card is issued → **Activate card** (one passkey prompt authorizes `enable_card`). |

> **Demo-mode caveat.** While `DEMO_MODE=true`, anyone who knows a seed agent's address can sign in as that agent. The damage is limited to spending testnet credit. `DEMO_ADMIN_SIGNIN=true` goes much further: it lets anyone sign in as the demo admin, who can read decrypted CPCV data, mint, settle, cancel and write off, move treasury funds, fast-forward the protocol clock and reset the demo. Use it only for a private demo, never on a public deployment. `DEMO_MODE=false` turns off seed sign-in, the demo clock and Reset demo.

QA aids: `/agent/preview` (behind an agent session; dev or `DEMO_MODE` only) and `/invest/preview?state=…` render every state from fixtures (nothing is signed or sent), and `/design` shows the design system.

## Card payments: Lithic sandbox or the simulated network

**Without `LITHIC_API_KEY`** (the default), the app runs a built-in simulated card network. "Simulate purchase" builds a Lithic-shaped ASA request and runs it in-process through the same parser, decision, database row and on-chain `card_draw` as `POST /api/lithic/asa`. Cards are `sim_card_…`, and "Reveal details" shows obviously fake data (`4000 0000 0000 <last4>`, CVV `000`).

**With a Lithic sandbox key:**

1. Set `LITHIC_API_KEY` in `apps/web/.env.local`. Agents onboarded from then on get real sandbox virtual cards (Visa test BIN). Cards issued earlier stay on the simulated network.
2. Expose the dev server: `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.
3. Enroll the ASA responder: `pnpm lithic:enroll --url https://<tunnel-host>`. It prints `LITHIC_ASA_HMAC_SECRET=whsec_…`; add that line to `.env.local` and restart. `--status` and `--disenroll` handle housekeeping.
4. Lithic starts signing ASA requests a few minutes after the secret is first created. Once the secret is set, unsigned requests are rejected, so early purchases may decline; wait and retry.

In production (`NODE_ENV=production`) the ASA endpoint fails closed: without `LITHIC_ASA_HMAC_SECRET` it answers 503 `ASA_NOT_CONFIGURED` and Lithic declines the purchase, so enroll before going live. The simulated network runs in-process and doesn't use the endpoint.

Lithic sandbox amounts are USD cents, which the app treats as EUR cents 1:1 (spec §2). Sandbox writes are limited to 1 per second, so the app spaces simulations 1.1 s apart.

## Deploying to Vercel + Neon

1. **Neon.** Create a project in a region close to your Vercel functions (e.g. AWS Frankfurt with Vercel `fra1`). The ASA must answer within about 2 s, and each decision makes several database round trips. Keep two connection strings: the **pooled** one for the app and the **direct** one for migrations.
2. **Migrate:** `DATABASE_URL='<neon direct url>' pnpm --filter web db:deploy` (`prisma migrate deploy`).
3. **Vercel project.** Import the repository with **Root Directory `apps/web`**. Next.js and pnpm are detected (root lockfile, `packageManager`); keep "Include files outside the root directory" enabled and set the Node.js version to **24.x**. [`apps/web/vercel.json`](./apps/web/vercel.json) adds the cron jobs. Route files set their own `maxDuration`; the longest, Reset demo, needs 300 s, which fits every plan with Fluid compute. The build itself needs no env vars.
4. **Environment variables.** Copy every value from `apps/web/.env.local`. The role keys must be the ones that will own the production contracts. Then change these:
   - `DATABASE_URL` = the Neon pooled URL
   - `APP_URL=https://advance.explorador.ai`
   - `WEBAUTHN_RP_ID=advance.explorador.ai`
   - `RESEND_API_KEY` and an `EMAIL_FROM` on a domain verified in Resend
   - `CRON_SECRET`: Vercel sends it as `Authorization: Bearer …` to cron routes
   - `LITHIC_*` if you use Lithic

   None of the variables is `NEXT_PUBLIC_`; they stay on the server.
5. **Domain.** Add `advance.explorador.ai`. Passkeys are bound to the RP ID, so passkeys made on `localhost` or a preview URL don't work on the production domain; agents register a new one there.
6. **Contracts and demo data for production.** `token_uri` is `${APP_URL}/api/notes/<id>`, fixed when `cpcv_note` is deployed, so reset against Neon with the production URL. Shell values win over `.env.local`:

   ```bash
   APP_URL=https://advance.explorador.ai DATABASE_URL='<neon url>' pnpm demo:reset
   ```

   This redeploys the contracts from the uploaded wasm and seeds Neon. It also records the active `Deployment` row (until that row exists the app reports "not deployed") and rewrites `deployments/testnet.json`. Commit that file so the documented ids match production. Admin → Demo → **Reset demo** on the production site does the same with the deployment's own `APP_URL`, but cannot update `deployments/testnet.json` (read-only filesystem).
7. **Lithic in production:** `pnpm lithic:enroll --url https://advance.explorador.ai`, put the printed `LITHIC_ASA_HMAC_SECRET` in Vercel, and redeploy. Without the secret, production declines every Lithic purchase.
8. **Crons.** `vercel.json` runs `/api/cron/sync` at 03:00 and `/api/cron/retry-draws` at 03:30 UTC, **once a day**. That is the Hobby-plan limit: Hobby crons run at most daily with ±59 min precision, and more frequent expressions fail the deployment. On Pro, tighten them, e.g. `*/5 * * * *` and `*/10 * * * *`. Both are safety nets: reads already sync the indexer on demand, and every admin dashboard load runs the card-draw retry sweep.

## Testing

| Suite | Command | At the time of writing |
|---|---|---|
| Contracts | `pnpm contracts:test` | 99 passed, 16 ignored (wasm-only) |
| Contracts on the optimized wasm | `pnpm contracts:build && cd contracts && cargo test --workspace -- --ignored` | 16 passed |
| Web (Vitest) | `pnpm --filter web test` | 724 passed; database-backed files skipped |
| Web incl. database tests | `TEST_DATABASE_URL=… pnpm --filter web test` | 797 passed, 1 skipped (opt-in testnet test) |
| Circuit | `pnpm circuits:test` | 21 passed |
| Types, lint, build | `pnpm typecheck`, `pnpm lint`, `pnpm build` | clean |
| End to end on testnet | `pnpm e2e` | 35 checks passed in 107 s |

- **Contracts.** Groth16 verification of committed snarkjs proofs (plus tampered inputs, tampered proofs and non-canonical inputs) and every `cpcv_note` mint rule: duplicate nullifier or commitment, wrong attester key or nullifier-secret commitment, escritura in the past, wrong recipient, soulbound. On the pool: vault math, the worked example (€88.77 / €4,411.23 single accrual, ≈ €90.08 with daily accruals), draw order, the credit, liquidity and leverage caps, settle with and without carried debt, cancel → grace → write-off (junior first), duplicate `auth_ref`, `advance_clock`, and an **invariant fuzz test** (3 seeds × 600 random operations, spec §5.3 checked after every operation with zero tolerance). `contracts/integration_tests` wires the three real contracts with strict authorization and replays the lifecycle on native code and on the optimized wasm, including size and per-transaction cost checks against testnet limits.
- **Web.** ASA decisions (approve, insufficient funds, idempotent retry, unknown card, signatures), `agent_field` parity, `property_hash`, proof formatting round trips, the registry's in-browser proof check, interest display math, auth and sessions, the admin pipeline and actions, the indexer and read models, investor transactions, and server-rendered UI states. To run the database tests, create a separate database once:

  ```bash
  docker compose exec postgres createdb -U advance advance_test
  DATABASE_URL=postgresql://advance:advance@localhost:5433/advance_test pnpm --filter web exec prisma db push
  TEST_DATABASE_URL=postgresql://advance:advance@localhost:5433/advance_test pnpm --filter web test
  ```

  The investor flow against a running app on testnet (a throwaway keypair stands in for Freighter) is opt-in: `INVEST_E2E_APP_URL=http://localhost:3000 pnpm --filter web exec vitest run lib/wallet/testnet.e2e`.
- **Circuit.** A valid witness and a real proof with the committed zkey, then every constraint violated on its own: rate out of range, wrong split, wrong commitment or nullifier, bad signature, escritura not after the CPCV.
- **`pnpm e2e`.** It uses its own database (`E2E_DATABASE_URL`, default `advance_e2e`, created and migrated on the fly; set it in the shell) and its own fresh contracts, so the demo is never touched. The flow: deploy → investor deposit → demo-signer agent → `enable_card` → CPCV €300,000 at 5% minted with on-chain proof verification → €3,000 purchase through the ASA pipeline plus a declined €1,000 one → +90 days → settle (interest €88.77, payout €4,411.23, junior +€7,500, share price up) → second CPCV → card-balance-then-credit draw → cancel → write-off refused before the deadline → +181 days → write-off absorbed by junior, agent blocked. Along the way it checks `agent_field` parity, `token_uri`, soulbound transfers and snarkjs verification of the registry proof. It prints contract ids, figures and tx links; [`ACCEPTANCE.md`](./ACCEPTANCE.md) has a full run.
- **Smart accounts:** `pnpm --filter @advance/scripts smoke:smart-account` checks the server-side auth encoding against the live OpenZeppelin account contracts.

## 5-minute demo script

Before you start: `pnpm demo:reset` (or Admin → Demo → **Reset demo**) for a fresh seeded state, Freighter on Testnet, and a phone (or a narrow window) for the agent. Signing up a new agent (email code + passkey → **Activate card**) takes a minute, so do it beforehand unless you want to show it live.

1. **Registry and pool** (`/registry`, `/invest`). "Every deal is on-chain, with no personal data: agent addresses only, counts by status." Open a note and click **Verify proof in your browser**: the page re-reads the note, the attester key and the verification key from the contract and checks the Groth16 proof with snarkjs. On `/invest`: "Investors earn yield from agents' advances, protected by explorador's first-loss capital": senior and junior assets, coverage, utilization, leverage against the 10× cap, target, projected and trailing APY.
2. **Investor.** Connect Freighter, **Get test XLM**, **Get 10,000 tEURC**, deposit €5,000. The eaSR shares, their value and the share price appear.
3. **Admin.** Sign in as admin: a real `ADMIN_EMAILS` address, or the seeded demo admin with its code from the server log (`DEMO_ADMIN_SIGNIN=true` puts it on screen for a private demo). Open **New CPCV**, click **Fill with demo data** (the worked example: €300,000 at 5%, escritura in 90 protocol days), pick the agent and submit. Watch the pipeline: *Validating → Signing attestation → Generating ZK proof → Verifying proof locally → Minting note on Stellar → Done*. The mint transaction is where `cpcv_note` verified the Groth16 proof on-chain. Open the note in the registry and verify the proof in the browser.
4. **Agent (phone).** Available to spend: **€3,750**. If you minted the note for a seed agent such as Carla instead, her credit available shows the same €3,750, next to her card balance from an earlier settlement. Simulate "Pastelaria Aloma €4.80" and "Worten €349.00": approved by the card-network flow, then confirmed on Stellar within seconds with a tx link. Debt and interest tick up live.
5. **Escritura.** Admin → Demo → **+30 days**: the demo clock chip in the header (already at +120 days from the seed) moves on, and interest jumps. Then CPCVs → **Confirm escritura**; the dialog previews debt and interest repaid, the card-balance payout and explorador's €7,500 junior deposit. The agent's debt disappears and the payout (the "€4,411.23" of the worked example, with these purchases instead) lands on the card balance. On `/invest` the share price has moved up.
6. **What if the buyer walks away?** Admin → CPCVs → **Cancel (buyer withdrew)** on Bruno's active Braga deal. Its debt joins the carried debt from his cancelled Faro deal, and his agent app shows the banner with the grace countdown (180 days from the first cancellation). Admin → Demo → *To the grace deadline of* Bruno, then Agents → **Write off**: junior absorbs the loss, senior investors are untouched, and "total written off" grows on `/invest`.

Reset the demo afterwards: fast-forwards move the clock for everyone.

## Trust model

(Spec §8.1; the registry page shows the same explainer.)

- **explorador is the attester.** It signs that a real CPCV exists with these terms. The proof does not remove that trust.
- The proof shows publicly, without revealing personal data, that:
  - explorador's attester key signed this exact deal record;
  - the commission was computed correctly from a hidden sale price and a commission rate between 1% and 10%;
  - the agent gets exactly half;
  - the escritura date is after the CPCV date;
  - the record is bound to this agent's account, so the note can only go to them;
  - the deal has a unique nullifier, so the same CPCV can never be financed twice.
- **Hidden:** buyer, seller, their NIFs, sale price, commission rate, property address, CPCV date.
- The commitment lets explorador open the record to an auditor later without changing anything on-chain.

## Security notes

- **Trust model as above.** explorador attests deals; the ZK proof protects privacy and enforces internal consistency and uniqueness.
- **Operator limits.** The operator can draw on an agent's credit only after the agent enabled the card with their passkey (`enable_card`), only up to that agent's borrowable amount, and only towards the fixed `card_settlement` address. A duplicate `auth_ref` is rejected. Minting needs a valid proof bound to the recipient; settling needs the treasury's signature as well.
- **Agents' own funds.** Agents can withdraw their card balance at any time with their passkey (`withdraw_balance`) and can pause the card (`disable_card`). Only the passkey that created the account can sign for it; extra passkeys only sign in.
- **Accounting-based share price.** `total_assets()` is the booked senior assets, not the token balance, so donations cannot move the eaSR price (no inflation attack). Conversions use a +1 virtual offset, and rounding always favours the pool: debts round up, shares and payouts round down.
- **Testnet keys only.** Never reuse them. `.env*` files are gitignored except the template, and `keys:generate` creates `.env.local` with mode 600.
- **Personal data.** It is encrypted with AES-256-GCM in Postgres, decrypted only for admins, and never on-chain. The registry shows addresses, never names.
- **Trusted setup.** The trusted setup is a local single-contributor ceremony: fine for a testnet demo, but whoever ran `circuits/build.sh` could forge proofs if they kept the entropy. The verifier rejects non-canonical public inputs (≥ the field modulus), which would otherwise let one deal pass the nullifier check twice.
- **ASA endpoint.** It verifies Standard Webhooks HMAC signatures with `LITHIC_ASA_HMAC_SECRET`. During development, unsigned requests are accepted until the secret is set. In production a missing secret makes the endpoint refuse every request (503 `ASA_NOT_CONFIGURED`). Card tokens are unguessable and draws can only pay `card_settlement`.
- **Sessions and sign-in.** Sessions are iron-session cookies (httpOnly, SameSite=Lax, `Secure` in production). Email codes are HMAC-hashed, single use, limited to 5 attempts and rate-limited. The admin role follows `ADMIN_EMAILS` on every sign-in, passkey included; a session started before a removal lasts until it expires (at most 7 days). State-changing routes accept only `application/json` (no cross-site form posts or login CSRF). API routes check the database-backed session on every call, and 500 responses hide internal details in production.
- **Faucet.** The public tEURC faucet is rate-limited per address (once a minute), per IP (5 per 10 minutes) and per server instance (20 a minute). Every grant is an operator transaction queued behind card draws.
- **Demo mode.** Seed agents sign in with codes shown on screen. The demo admin's code appears there only with the `DEMO_ADMIN_SIGNIN` opt-in. The admin can move the protocol clock forward (interest, grace periods) because `demo_mode` was set at deploy, and Reset demo redeploys everything. Turn `DEMO_MODE` off outside demos.
- **Cron routes.** `/api/cron/sync` is public (idempotent, read-only towards the chain). `/api/cron/retry-draws` needs an admin session or `CRON_SECRET`.

## Testnet caveats

- **Testnet resets.** Stellar testnet is wiped periodically. Afterwards the contract code is gone, so `pnpm demo:reset` refuses: run `pnpm deploy:testnet` and `pnpm seed`. The smart-account infrastructure must come back too. Re-upload the account wasm (`stellar contract fetch --wasm-hash 1b5f4534… --network mainnet` gives the identical code), redeploy the WebAuthn and Ed25519 verifiers, and set `SMART_ACCOUNT_WASM_HASH`, `WEBAUTHN_VERIFIER_ID` and `ED25519_VERIFIER_ID`. While the code is still live, `pnpm demo:reset` restores the seeded state in about 165 s.
- **Fee spikes.** Soroban rent and write fees follow the live state size. During a spike measured on 25 Oct 2026 (16:40–17:33 UTC), a mint cost about 1,000–1,400 XLM, a card draw 50–100 XLM and a wasm upload 2,500–14,300 XLM. When fees dropped at about 17:34 UTC, the same mint and draw cost 0.22–0.25 and 0.02–0.04 XLM. The tooling fee-bumps transactions whose fee exceeds the uint32 cap (otherwise no mint could be submitted during a spike) and tops payers up from Friendbot. Onboarding an agent costs the sponsor tens of XLM in a spike; keep it funded with `pnpm --filter @advance/scripts fund`.
- **TTL and archival.** TTLs count real ledgers; demo fast-forwards don't age anything. Contract instances live about 30 days and persistent records (notes, lines, agents, balances) about 90 days, extended on use. Contract code lives 30 days after deploy; once it drops below 15 days, the next call extends it, and whoever sends that call pays (thousands of XLM during a spike). `pnpm --filter @advance/scripts ttl` shows the TTLs, and `--extend-days 90` (with `--dry-run` to price it first) pre-extends code and instances from the admin. The current deployment is extended to about 23 Jan 2027. Archived entries are restored automatically by the next transaction that needs them, at a higher fee.
- **Event retention.** The RPC keeps events for about 7 days, and the indexer reports older gaps as lost. History older than that cannot be re-indexed.

## Path to production

Out of scope for the hackathon (spec §13):

- Real Circle EURC (the contracts already take the asset address), SEP-24 anchors and a EUR off-ramp to IBAN.
- KYC/AML and licensing: credit intermediation and card issuing need a licensed EU partner; Lithic is used in sandbox only.
- EU card issuance, partial approvals, clearing adjustments, and refunds or chargebacks on-chain.
- A withdrawal queue for investors when liquidity is low.
- Credit scoring or dynamic LTV, and handling of escritura delays.
- Mainnet deployment and audits.

Also needed before real money:

- A multi-party trusted-setup ceremony.
- Operator and treasury keys in an HSM or multisig.
- A TTL keeper.
- Replacing the operator's `enable_card` consent with an OpenZeppelin smart-account policy (a session signer allowed only `card_draw`, with a daily limit).
- An on-chain Poseidon Merkle root of commitments, so auditors can prove inclusion.
- Qualified electronic signatures (Chave Móvel Digital) on the CPCV.

## Credits

Built with [Claude Code](https://claude.com/claude-code). Parallel Claude agents each owned a workstream in its own git worktree: contracts, circuit, Stellar service, smart accounts, card, agent app, investor dashboard, admin, landing and registry, deploy, security review, and docs. An orchestrator merged them against [`spec.md`](./spec.md), and every judgment call is logged in [`DECISIONS.md`](./DECISIONS.md).

Built on Stellar and Soroban (BN254 and Poseidon host functions), OpenZeppelin Stellar contracts and smart-account-kit, circom, snarkjs and circomlib (iden3), Lithic's sandbox, Prisma, Next.js, Neon and Vercel. The Sora typeface is used under the SIL Open Font License.
