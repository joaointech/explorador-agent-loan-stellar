# explorador advance

**Close the deal. Get paid today.** explorador advance lets explorador's real-estate agents spend part of their future commission the moment a CPCV is signed, months before the escritura, with a card. Investors fund those advances through a pooled vault on Stellar and earn the interest agents pay, protected by explorador's first-loss capital.

Hackathon build, Stellar **testnet** only. Lives at `advance.explorador.ai`.

## How it works

1. A CPCV is signed → explorador generates a **zero-knowledge proof** of the deal (reveals the commission and the agent; hides buyer, seller, price and property).
2. The proof is verified **on-chain on Soroban** (BN254 host functions) and a soulbound **CPCV Note** (SEP-50) is minted to the agent's passkey smart account and listed in a public registry.
3. The agent pays with a **card** (Lithic sandbox). Purchases come from their card balance first, then are **borrowed in tEURC** from the pool against their CPCV Notes.
4. **Investors** deposit tEURC into the senior vault (SEP-56, share token `eaSR`) with Freighter and earn up to an 8% target APY.
5. At the **escritura**, the commission settles on-chain: the agent's debt plus interest is repaid, the rest of their half lands on their card balance, and explorador's half tops up the first-loss tranche.

Full specification: [`spec.md`](./spec.md). Decisions taken during the build: [`DECISIONS.md`](./DECISIONS.md).

## Repository

| Path | What |
|---|---|
| `apps/web` | Next.js 16 app: landing, agent app, investor dashboard, admin panel, public registry, API routes, Lithic ASA responder |
| `contracts` | Soroban contracts: `teurc` (SEP-41), `cpcv_note` (SEP-50 + Groth16 verifier), `advance_pool` (SEP-56 vault + credit lines) |
| `circuits` | Circom circuit for the CPCV attestation proof |
| `scripts` | Keys, deploy, seed, demo reset, Lithic enrollment, indexer, e2e |
| `packages/contracts-ts` | Generated TypeScript contract bindings |

## Quick start

```bash
pnpm install          # Node 24 is pinned via .npmrc
pnpm db:up            # Postgres 16 on localhost:5433
cp apps/web/.env.example apps/web/.env.local
pnpm dev              # http://localhost:3000
```

Setup, deploy and demo instructions are completed as the build lands.
