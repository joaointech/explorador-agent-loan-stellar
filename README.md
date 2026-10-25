# explorador advance

Commission advances for real-estate agents, funded by investors and settled on **Stellar testnet**.

An agent closes a deal at the **CPCV**, the promissory contract. explorador attests the deal
with a **zero-knowledge proof** (Circom, Groth16 over BN254, Poseidon). Soroban verifies it
on-chain and mints a **soulbound CPCV Note** (SEP-50) to the agent's **passkey smart account**.
The note opens a credit line of 50% of the agent's half of the commission. The agent spends it
with a **Lithic sandbox card**: each purchase uses their card balance first, then borrows tEURC
from an investor pool (a SEP-56 senior vault with share token `eaSR`).

At the **escritura** (the deed signing), the commission is paid into the pool contract. It
repays the debt plus 12% APR interest, credits the rest of the agent's half to their card, and
adds explorador's half to the first-loss (junior) tranche. If the buyer walks away, the debt is
carried to the agent's next deals for 180 days and then written off, against junior capital first.

> Testnet demo. No KYC, no real money. Every key in this repo's tooling is **testnet-only; never reuse them**.

- Spec: [`spec.md`](spec.md)
- Choices and deviations: [`DECISIONS.md`](DECISIONS.md)

## What's in the repo

```
apps/web/              Next.js 16 app: pages, API routes, ASA responder, Prisma schema
  lib/                 stellar/, zk/, lithic/, auth/, indexer/, ops/ (deploy, seed, reset)
  zk/                  circuit wasm + zkey + verification keys (committed build outputs)
  contracts-wasm/      contract wasm the app encodes calls with (copied by deploy)
contracts/             Soroban workspace: teurc (SEP-41), cpcv_note (SEP-50 + registry +
                       Groth16 verifier), advance_pool (SEP-56 vault + credit lines), shared
circuits/              cpcv_attestation.circom, build.sh (local trusted setup), tests
packages/zk            attestation encodings shared by the server, circuit tests and browser
packages/contracts-ts  generated TypeScript bindings
scripts/               keys:generate, deploy, seed, demo:reset, lithic:enroll, indexer, e2e
deployments/           testnet.json (contract ids + wasm hashes, written by deploy)
```

## Prerequisites

- Node 22+, pnpm 11 (`corepack enable`), Docker (for Postgres)
- To rebuild contracts: Rust (stable, with the `wasm32v1-none` target) and Stellar CLI 28 (`stellar`)
- To rebuild the circuit: circom 2.2

The compiled contracts (`apps/web/contracts-wasm/`) and circuit artifacts (`apps/web/zk/`) are
committed, so a fresh clone can deploy and run without Rust or circom.

## Setup (fresh clone)

```bash
pnpm install                       # also generates the Prisma client
docker compose up -d               # Postgres 16 on localhost:5433
pnpm keys:generate                 # role keys (Friendbot-funded), attester key, secrets → apps/web/.env.local
                                   # edit ADMIN_EMAILS in apps/web/.env.local (default admin@explorador.pt)
pnpm db:push                       # create the tables
pnpm deploy:testnet --no-build     # deploy the committed wasm (drop --no-build to rebuild with `stellar contract build`)
pnpm seed                          # demo agents, investors, five CPCVs, card history (~3–5 min on testnet)
pnpm dev                           # http://localhost:3000
```

Sign in at `/login`:

- **Admin:** the first `ADMIN_EMAILS` address. Use the email code; without `RESEND_API_KEY`
  it's printed in the dev server console as `[explorador advance] sign-in code for …`.
- **Seed agents:** `ana@demo.explorador.pt`, `bruno@demo.explorador.pt` and
  `carla@demo.explorador.pt` sign in with the email code. Their smart accounts use a
  server-held Ed25519 demo signer.
- **New agents:** any other email, then create a passkey. That deploys the agent's smart account,
  and "Activate card" signs `enable_card` with the passkey.
- **Investors:** `/invest` with the [Freighter](https://freighter.app) extension set to
  **Testnet**. "Get test XLM" uses Friendbot; "Get 10,000 tEURC" uses the faucet.

`apps/web/.env.example` lists every variable (spec §11.3). Contract ids are read from the active
`Deployment` row, falling back to `deployments/testnet.json`, so a redeploy needs no env changes.

## Scripts

| Command | Does |
|---|---|
| `pnpm keys:generate` | Admin / operator / treasury / card-settlement / sponsor keypairs (Friendbot-funded), BabyJubJub attester key, `NULLIFIER_SECRET`, `PII_ENCRYPTION_KEY`, `SESSION_SECRET`, `CRON_SECRET` → `apps/web/.env.local`. Existing values are kept. |
| `pnpm circuits:build` | Compile the circuit, run a local Powers of Tau (2^15) and Groth16 setup, and export both verification keys. **A new key needs a redeploy.** |
| `pnpm contracts:build` / `contracts:test` | `stellar contract build` / `cargo test` (52 tests) |
| `pnpm deploy:testnet [--no-build]` | §7.4 wiring. Writes `deployments/testnet.json` and a `Deployment` row, and generates the TS bindings. |
| `pnpm seed [--clear]` | Demo data (§11.2) on the active deployment |
| `pnpm demo:reset` | Redeploy from the stored wasm hashes, clear history, then seed. Same code as the admin "Reset demo" button. |
| `pnpm lithic:enroll [--url https://…]` | Enroll `<url>/api/lithic/asa` as the ASA responder and store `LITHIC_ASA_HMAC_SECRET` |
| `pnpm indexer` | Long-running event indexer and failed-draw retrier (optional: read routes also sync lazily) |
| `pnpm test` | Web unit tests (Vitest) + circuit tests |
| `pnpm e2e` | Full flow on testnet (§12.1), in its own `<db>_e2e` database |
| `pnpm dev` / `pnpm build` | Next.js dev server / production build |

## Lithic sandbox (card)

Without `LITHIC_API_KEY`, "Simulate purchase" runs the same approval logic as the ASA responder
in-process. The approve / decline decision and the on-chain `card_draw` are real; only the Lithic
round trip is skipped. To use Lithic:

1. Put a sandbox key in `LITHIC_API_KEY`. Cards are created on the agent's next page load.
2. Expose the dev server, e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.
3. Run `pnpm lithic:enroll --url https://<tunnel-host>` and restart `pnpm dev`.

Lithic sandbox amounts are USD cents; the app treats them as EUR cents, 1:1.

## Demo script (5 minutes)

1. **Registry and pool** (`/registry`, `/invest`): every deal is on-chain with no personal data.
   Investors earn yield from agents' advances, protected by explorador's first-loss capital.
2. **Investor:** connect Freighter, get 10,000 tEURC, deposit 5,000 and show the shares.
3. **Admin** (`/admin` → New CPCV): create a CPCV for a live agent (€300,000, 5%, escritura in 90
   days). The pipeline shows attestation → ZK proof → on-chain verification → note minted.
   Open the note in the registry and click **Verify proof in your browser**.
4. **Agent** (phone): €3,750 available. Simulate "Pastelaria Aloma €4.80" and "Worten €349.00".
   Each is approved, then borrowed on Stellar within seconds; debt and interest tick up.
5. **Escritura** (admin → CPCVs → Confirm escritura): the agent's debt disappears, the payout
   lands on the card balance, explorador's half goes into the first-loss tranche, and the share
   price rises.
6. **Buyer walks away:** cancel a deal. The debt is carried and the grace countdown starts.
   Admin → Demo → "To grace deadline", then Agents → **Write off**: junior absorbs the loss and
   senior is untouched.

The protocol clock can be fast-forwarded (admin → Demo) because the pool was deployed with
`DEMO_MODE=true`. The header chip shows how far ahead of real time it is.

## Trust model (spec §8.1)

- **explorador is the attester.** It signs that a real CPCV exists with these terms. The proof
  does not remove that trust.
- The proof shows publicly, without revealing personal data, that:
  - explorador's attester key signed this exact deal record;
  - the commission was computed correctly from a hidden sale price and a commission rate
    between 1% and 10%;
  - the agent gets exactly half;
  - the escritura date is after the CPCV date;
  - the record is bound to this specific agent's account, so the note can only go to them;
  - the deal has a unique nullifier, so the same CPCV can never be financed twice.
- **Hidden:** buyer, seller, their NIFs, sale price, commission rate, property address and CPCV date.
  This data is stored encrypted (AES-256-GCM) in Postgres and never goes on-chain.
- The commitment lets explorador open the record to an auditor later without changing anything on-chain.

## Security notes

- Trust model as above: explorador attests deals. ZK protects privacy and enforces internal
  consistency and uniqueness.
- The operator can draw on an agent's credit only after the agent has enabled the card with their
  passkey, and only up to the agent's credit. Funds always go to the fixed `card_settlement` address.
- Agents can withdraw their card balance at any time with their passkey.
- The senior share price is accounting-based, so donations can't manipulate it.
- Operator transactions are serialized through a Postgres advisory lock. The ASA responder fails
  closed: any error declines.
- Keys are **testnet-only; never reuse them.** `apps/web/.env.local` is git-ignored.

## Testnet notes

- **Testnet resets** wipe all contracts and accounts. Afterwards run `pnpm keys:generate`
  (re-funds the roles) and `pnpm demo:reset`, or press **Reset demo** in the admin panel.
- **Rent surcharge.** Testnet's Soroban state is above its target size, so rent is heavily
  surcharged. Uploading the contract code costs thousands of XLM. The deploy scripts top the
  admin up automatically (Friendbot plus account merges) and submit with a fee bump. Contract
  entries are extended to only 10 days, so redeploy (`pnpm demo:reset`) at least every week or
  two on a long-lived demo. See DECISIONS.md.

## Hosting (Vercel + Neon)

- Set the Vercel project root to `apps/web`, add the env vars from `.env.local`, and point
  `DATABASE_URL` at Neon. Then run `pnpm db:push` against it once and redeploy the contracts
  (`APP_URL` sets the note metadata URL).
- `apps/web/vercel.json` schedules `/api/cron/sync` and `/api/cron/retry-draws` daily (the Hobby
  limit); read routes also sync lazily. Vercel sends `CRON_SECRET` as a bearer token.
- Set `WEBAUTHN_RP_ID` to the production host name, and re-run `pnpm lithic:enroll --url https://<host>`.

## Path to production (out of scope here)

- Real Circle EURC, SEP-24 anchors and an EUR off-ramp to IBAN
- KYC/AML and licensing (credit intermediation and card issuing need a licensed EU partner; Lithic is sandbox-only here)
- EU card issuance, partial approvals, clearing adjustments, refunds and chargebacks on-chain
- A withdrawal queue for investors when liquidity is low
- Credit scoring / dynamic LTV, and escritura delay handling
- Mainnet deployment and audits
