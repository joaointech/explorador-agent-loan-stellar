# explorador advance — Build Specification

> **What this document is.** A complete specification for building *explorador advance* in one pass. It is written as a prompt for a coding agent. Build everything described here. Where a detail is genuinely unspecified, choose the simplest option that is consistent with this document, and record the choice in `DECISIONS.md` at the repo root. Do not silently drop features; if something cannot be done, implement the closest working version and record why in `DECISIONS.md`.

---

## 0. Summary

**explorador** (explorador.pt) is an AI real-estate platform in Portugal. It works like a marketplace: explorador generates leads, and independent real-estate agents work those leads and close deals. When a deal closes, the commission is split **50% to the agent and 50% to explorador**.

The problem: an agent closes a deal when the buyer and seller sign the **CPCV** (contrato-promessa de compra e venda, the promissory purchase contract), but the commission is only paid at the **escritura** (the deed signing), which is often months later. Agents wait months to get paid.

**explorador advance** lets agents spend part of their future commission immediately:

1. When a CPCV is signed, explorador generates a **zero-knowledge proof** of the deal. The proof reveals the commission and the agent, and hides the buyer, seller, sale price and property.
2. The proof is verified on-chain on **Stellar (Soroban)** and a **soulbound NFT** (a "CPCV Note") is minted to the agent's smart account. Every note is listed in a **public on-chain registry**.
3. The agent gets a **card** (Lithic, sandbox). When they pay with it, the purchase is funded first from their card balance and then by **borrowing EURC** from an investor **liquidity pool**, using their CPCV Notes as collateral. The agent never sees a wallet: their account is a **passkey smart wallet**.
4. **Investors** deposit EURC into the pool (connecting with Freighter) and earn yield from the interest agents pay.
5. At the escritura, explorador pays the commission into the pool contract, which automatically **repays the agent's debt plus interest**, credits the rest of the agent's half to their **card balance**, and deposits **explorador's half into the pool's first-loss tranche**.
6. If the buyer walks away and the escritura never happens, the debt moves to the agent's future deals, with a grace period; if it is still unpaid afterwards, it is written off against **explorador's first-loss capital first**.

Everything runs on **Stellar testnet**. Card payments use **Lithic sandbox**. There is **no KYC**. The UI is **English only**.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| CPCV | Promissory purchase contract. Signing it is the moment an agent "closes" a deal. |
| Escritura | Deed signing. The sale completes and the commission is paid. |
| Total commission | The commission the seller pays on the sale. Assume no VAT exists. |
| Agent commission | `floor(total_commission / 2)`. explorador's share is `total_commission − agent_commission`. |
| CPCV Note | Soulbound SEP-50 NFT minted to the agent after the ZK proof verifies. It is the collateral for a credit line. |
| Credit line | Per-note borrowing capacity: `credit_limit = agent_commission × LTV`. |
| Card balance | EURC that belongs to the agent, held inside the pool contract, spendable by card. Filled by settlements. |
| Carried debt | Debt from a cancelled note that is moved onto the agent and repaid from future settlements. |
| Senior tranche | Investor capital. A SEP-56 vault with share token `eaSR`. Gets interest first up to a target APY; takes losses last. |
| Junior tranche | explorador's capital (first-loss). Seeded at launch and topped up by explorador's 50% at each settlement. |
| Operator | explorador's backend key. It mints notes, records card draws, settles and cancels. |
| Treasury | explorador's account that pays commissions and owns the junior tranche. |
| tEURC | Test EURC: a SEP-41 token deployed by us on testnet that stands in for Circle EURC. 7 decimals. |
| Protocol clock | The contract's notion of time. Equal to ledger time, optionally accelerated for demos (see §5.7). |

---

## 2. Fixed decisions

These were decided with the product owner. Do not change them.

| Topic | Decision |
|---|---|
| Chain | Stellar only, **testnet only**. Use Stellar standards (SEP-41, SEP-50, SEP-56), never EVM/ERC terminology in code or UI. |
| Stack | Next.js (latest stable, App Router) + TypeScript + Postgres (Prisma) + Rust/Soroban contracts. pnpm workspace. |
| ZK | Circom + Groth16 over **BN254**, with **Poseidon** hashing. Verified on-chain using Soroban's native BN254 host functions (Protocol 25 "X-Ray" and later). |
| NFT | Soulbound to the agent (transfers and approvals always fail). |
| Agent wallet | **Passkey smart wallet** (OpenZeppelin smart account with a WebAuthn/secp256r1 signer). The agent never sees a wallet, seed phrase or fee. |
| Investor wallet | **Freighter**. |
| Auth | Email + passkey for agents and admins. No KYC. |
| Card | **Lithic sandbox**, Auth Stream Access (ASA). Approve from cached on-chain state, then record the borrow on-chain asynchronously. Lithic sandbox amounts are USD cents; the app treats them as **EUR cents, 1:1**. |
| Currency | Mock EURC (`tEURC`) that we deploy and can mint freely. Contracts take the asset address as a parameter, so real Circle EURC can be swapped in later. |
| Commission split | Agent 50%, explorador 50%. Always. |
| LTV | 50% of the agent commission (= 25% of total commission) per note. |
| Agent interest | 12% APR, fixed, charged only on the drawn balance, accrued continuously. |
| Protocol fee | 10% of interest, to explorador. |
| Tranches | Senior (investors) gets interest first up to an **8% APY target**; junior (explorador) gets the remainder. Losses hit junior first, then senior. |
| Junior seed | 10,000 tEURC at launch. |
| Leverage cap | Total outstanding debt ≤ 10 × junior assets. |
| Multiple notes | An agent can borrow against several notes at once (one combined credit line). |
| Settlement payout | Remainder of the agent's half goes to their **card balance**. |
| Escritura confirmation | explorador operator key confirms settlement or cancellation on-chain. |
| Escritura delays | Assume they don't happen. No maximum-term logic; just show an "Overdue" badge if the protocol date passes the escritura date. |
| Buyer walks away | explorador gets nothing. Debt moves to the agent ("carried debt"), the agent's next settlements repay it first, 180-day grace period, then write-off against junior first. Interest keeps running during the grace period. |
| Registry | On-chain registry (the note contract) + public explorer page. Show the agent's **address only**, never their name. |
| Card amounts | Treated as EUR. |
| Card spending order | Card balance first, then credit. |
| Seed data | Yes, plus a "Reset demo" button in the admin panel. |
| Hosting | Vercel + Neon Postgres for deploy; Docker Compose (Postgres) for local dev. |
| Product name | **explorador advance** (always lowercase, like the explorador brand). |
| Language | English only. |
| Design | Match explorador.pt (see §10). |

---

## 3. Actors and roles

| Actor | How they authenticate | What they can do |
|---|---|---|
| **Agent** | Email code, then passkey (WebAuthn). Their passkey is also the signer of their smart account. | See card, balance, credit, debt, deals; simulate card purchases; enable the card on-chain; withdraw card balance to their smart account. |
| **Investor** | Freighter (no account in our DB). | Get test XLM and test EURC, deposit into / withdraw from the senior vault, see pool health and their position. |
| **Admin** (explorador staff) | Email code, then passkey. Admin if the email is in `ADMIN_EMAILS`. | Create CPCVs (generates proof + mints note), confirm escritura (settle), cancel, write off, manage junior tranche, claim fees, reset demo. |
| **Public** | None. | Landing page, registry explorer, pool stats. |

On-chain roles (Soroban addresses):

| Role | Key | Used for |
|---|---|---|
| `admin` | `ADMIN_SECRET` | Contract configuration, one-time wiring. |
| `operator` | `OPERATOR_SECRET` | `mint` notes, `card_draw`, `settle`, `cancel`, `write_off`, `set_blocked`. |
| `treasury` | `TREASURY_SECRET` | Pays commissions at settlement; owns the junior tranche; receives protocol fees. |
| `card_settlement` | `CARD_SETTLEMENT_PUBLIC` | Receives EURC for each card spend (represents funding the card program). |
| `sponsor` | `SPONSOR_SECRET` | Transaction source and fee payer for agent (passkey) transactions. |
| `attester` | `ATTESTER_EDDSA_PRIVKEY` (BabyJubJub, off-chain) | Signs CPCV attestations that the circuit verifies. |

In the demo, several of these may be the same account, but keep them as separate config values everywhere.

---

## 4. Core flows

### 4.1 Investor deposits

1. Investor opens `/invest`, connects Freighter (testnet).
2. If needed: "Get test XLM" (Friendbot) and "Get 10,000 tEURC" (`teurc.faucet`).
3. Enters an amount → `advance_pool.deposit(assets, receiver=me, from=me, operator=me)` signed in Freighter. Receives `eaSR` shares.
4. Withdraw → `advance_pool.withdraw(assets, receiver, owner, operator)` or `redeem(shares, …)`, limited to available liquidity (§5.5).

### 4.2 Agent onboarding

1. Agent opens `/agent`, enters email, receives a 6-digit code (Resend), enters it.
2. Agent creates a passkey (one prompt). The server stores the WebAuthn credential and the backend deploys an OpenZeppelin smart account whose signer is that passkey's P-256 public key (fees paid by `sponsor`).
3. Backend creates a Lithic sandbox **virtual card** for the agent (Visa test BIN).
4. Agent taps **Activate card** → passkey prompt → `advance_pool.enable_card(agent)` is authorized by the smart account (this is the agent's on-chain consent for the operator to draw on their behalf when they use the card).
5. Agent sees the dashboard. Until they have a note, available credit is €0.

### 4.3 CPCV → proof → note (admin)

1. Admin fills **New CPCV**: agent, buyer name + NIF, seller name + NIF, property address, sale price, commission rate, CPCV date, escritura date. The form shows the computed total commission, agent/explorador split and credit limit live.
2. On submit, the server runs a pipeline and the UI shows each step: *Validating → Signing attestation → Generating ZK proof → Verifying proof locally → Minting note on Stellar → Done*.
3. The server encrypts and stores the private CPCV data in Postgres, computes the commitment/nullifier, signs the attestation, generates the Groth16 proof (snarkjs), verifies it locally, then calls `cpcv_note.mint(...)` as `operator`.
4. The note contract verifies the proof on-chain, checks the nullifier hasn't been used, mints the soulbound note to the agent's smart account, records it in the registry, and calls `advance_pool.open_line(note_id)`, which opens a credit line of `agent_commission × 50%`.
5. The note appears in `/registry` with public data only.

### 4.4 Card purchase

1. Agent taps **Simulate purchase** (amount + merchant name) in the agent app. The server calls Lithic `simulateAuthorization` with the agent's card PAN.
2. Lithic sends an **ASA request** to `POST /api/lithic/asa`.
3. The ASA handler (must respond in < 2 s):
   - looks up the agent by `card.token`;
   - reads `advance_pool.agent_position(agent)` and `stats()` via RPC simulation (1.2 s timeout; fall back to the cached value stored on the agent row);
   - computes `spendable = card_balance + min(available_credit, lendable, leverage_headroom) − pending_holds`, where `pending_holds` = sum of this agent's approved authorizations not yet confirmed on-chain;
   - approves with `{"result":"APPROVED"}` if `amount ≤ spendable`, otherwise `{"result":"INSUFFICIENT_FUNDS"}`;
   - writes a `CardAuthorization` row (idempotent on the Lithic transaction token).
4. After responding (Next.js `after()`), the server submits `advance_pool.card_draw(agent, amount, auth_ref)` as `operator`. The contract spends card balance first, then borrows from the agent's credit lines (earliest escritura first), and transfers the EURC to `card_settlement`.
5. The row is updated with the split (`from_balance`, `from_credit`) and the tx hash. The dashboard shows the purchase, the new debt, and interest ticking up live.
6. If the on-chain draw fails (state changed in between), mark the row `FAILED`, show it in the admin panel as "unfunded card spend — covered by treasury", and do not retry automatically more than 3 times.

### 4.5 Escritura (settle)

1. Admin clicks **Confirm escritura** on a minted CPCV.
2. Server calls `advance_pool.settle(note_id)` signed by `operator` and `treasury`.
3. The pool contract pulls `total_commission` tEURC from `treasury`, then:
   - repays the note's debt (principal + interest);
   - repays any carried debt of the agent;
   - credits the remainder of the agent's half to the agent's card balance;
   - adds explorador's half to the junior tranche;
   - marks the note `Settled` (in both contracts).
4. Agent sees "Deal settled: €X added to your card balance". Investors see the share price rise (interest is already accrued; settlement converts it to cash).

### 4.6 Buyer walks away (cancel → grace → write-off)

1. Admin clicks **Cancel (buyer withdrew)**. Server calls `advance_pool.cancel(note_id)`.
2. The note's debt moves to the agent's carried debt; the note's credit line closes; any card balance the agent has is used immediately to repay carried debt; `grace_deadline = now + 180 days` (protocol clock) if not already set.
3. Carried debt keeps accruing interest and reduces the agent's available credit on other notes. Any later settlement for this agent repays it first.
4. After the deadline, admin can click **Write off**: `advance_pool.write_off(agent)` removes the carried debt from the book. The loss is taken from junior assets first, then senior. The agent is blocked from new credit.

---

## 5. Economic model

All on-chain amounts are **i128 in tEURC base units (stroops, 7 decimals)**. All off-chain/circuit amounts are **EUR cents**. Conversion: `stroops = cents × 100_000`.

### 5.1 Parameters (constructor of `advance_pool`; immutable after deploy except where noted)

| Name | Value | Notes |
|---|---|---|
| `agent_apr_bps` | 1200 | 12% APR on drawn balance. |
| `protocol_fee_bps` | 1000 | 10% of interest to explorador. |
| `senior_target_bps` | 800 | 8% APY target for senior. |
| `ltv_bps` | 5000 | Credit limit = 50% of agent commission. |
| `grace_period_secs` | 180 × 86,400 | 180 days on the protocol clock. |
| `max_leverage` | 10 | Total debt ≤ 10 × junior assets. |
| `demo_mode` | `true` on demo deployments (`DEMO_MODE`), `false` otherwise | Enables the admin fast-forward of the protocol clock (§5.7). |

Constants: `SCALE = 10^18` (fixed-point), `YEAR = 31_536_000` seconds, `BPS = 10_000`.

### 5.2 Debt accounting (borrow index)

One global `borrow_index` (starts at `SCALE`) grows at the agent APR. Each credit line and each agent's carried debt stores a **scaled** debt.

```
accrue():
  dt = protocol_now − last_accrual           // seconds on protocol clock
  if dt == 0: return
  old_debt   = total_scaled_debt × borrow_index / SCALE
  borrow_index += borrow_index × agent_apr_bps × dt / (BPS × YEAR)
  new_debt   = total_scaled_debt × borrow_index / SCALE
  interest   = new_debt − old_debt
  fee        = interest × protocol_fee_bps / BPS
  net        = interest − fee
  senior_due = senior_assets × senior_target_bps × dt / (BPS × YEAR)
  to_senior  = min(net, senior_due)
  to_junior  = net − to_senior
  fees_accrued  += fee
  senior_assets += to_senior
  junior_assets += to_junior
  last_accrual = protocol_now

borrow(amount) on a line:   line.scaled += ceil(amount × SCALE / borrow_index); line.principal += amount
debt(line)               =  ceil(line.scaled × borrow_index / SCALE)
```

Every state-changing pool function calls `accrue()` first. View functions compute a non-mutating preview of `accrue()` so numbers are always current.

Because the index grows by simple interest over each accrual interval and then compounds into the next one, the effective cost depends on how often the pool is touched: one accrual over 90 days gives exactly simple interest; frequent activity approaches continuous compounding (12% APR ≈ 12.75% effective per year). Show "12% APR" in the UI and always display the actual debt from the contract.

Rounding always favours the pool: debts round up, shares issued round down, assets paid out round down.

### 5.3 Core invariant

At all times (allowing a few stroops of rounding dust):

```
senior_assets + junior_assets + fees_accrued  ==  pool_cash + total_debt
where pool_cash  = asset.balance(pool) − total_card_balances
      total_debt = total_scaled_debt × borrow_index / SCALE
```

Write a Rust test that checks this after every operation in a long randomized sequence.

### 5.4 Credit availability

```
line_available(line)   = max(0, line.credit_limit − debt(line))        // active lines only
agent_available_credit = blocked ? 0 : max(0, Σ line_available − carried_debt)
lendable               = max(0, pool_cash − fees_accrued)
leverage_headroom      = max(0, max_leverage × junior_assets − total_debt)
borrowable_now         = min(agent_available_credit, lendable, leverage_headroom)
```

`card_draw` takes from the agent's lines in order of **earliest `escritura_day` first**.

### 5.5 Senior vault (SEP-56) and yield

- Share token: `eaSR` ("explorador advance Senior"), 7 decimals, SEP-41.
- `total_assets()` = `senior_assets` (after preview accrual). It is **accounting-based, not balance-based**, so token donations to the contract cannot move the share price (no inflation/donation attack).
- Conversions (the same math as the SEP-56 reference implementation, rounding down for the user):
  - `convert_to_shares(a) = a × (supply + 1) / (total_assets + 1)`
  - `convert_to_assets(s) = s × (total_assets + 1) / (supply + 1)`
- `max_withdraw(owner) = min(convert_to_assets(balance(owner)), lendable)`; `max_redeem` likewise. No withdrawal queue.
- Displayed yields (computed in the app, not on-chain):
  - **Target APY**: 8%.
  - **Projected APY**: `net_interest_per_year = total_debt × apr × (1 − fee)` → `senior = min(8%, net_interest_per_year / senior_assets)`; `junior = (net_interest_per_year − senior × senior_assets) / junior_assets`.
  - **Trailing APY (7 protocol days)**: from share-price snapshots: `(p_now / p_then)^(YEAR/Δt) − 1`.

### 5.6 Worked example (use these exact numbers in tests and the landing page)

- Sale price €300,000, commission rate 5% → **total commission €15,000**; agent €7,500; explorador €7,500; **credit limit €3,750**.
- Agent spends €3,000 on day 0; escritura on day 90, with **no other pool activity in between** (a single accrual). Interest = €3,000 × 12% × 90/365 = **€88.77**; protocol fee €8.88; €79.89 to the tranches.
- At settlement: debt €3,088.77 repaid; **€4,411.23** to the agent's card balance; **€7,500** to the junior tranche.
- With daily pool activity the interest compounds and comes to ≈ €90.08 instead. Tests use the single-accrual case so the numbers are exact.

Yield illustration (senior €100,000, junior €10,000):
- Debt €60,000 → net interest €6,480/yr → senior gets all of it: **6.48%**, junior 0%.
- Debt €90,000 → net interest €9,720/yr → senior **8.00%**, junior €1,720 on €10,000 = **17.2%**.

Loss illustration: a cancelled note with €2,000 carried debt is written off → junior falls from €10,000 to €8,000; senior is untouched.

### 5.7 Protocol clock (demo fast-forward)

```
protocol_now = ledger_timestamp + demo_offset
```

`demo_offset` starts at 0. When `demo_mode` is true, the admin can call `advance_pool.advance_clock(secs)` to add to it (it only ever increases). All time logic (interest, grace period, escritura checks, "today") uses the protocol clock, so fast-forwarding 30 days immediately accrues 30 days of interest, and fast-forwarding past a grace deadline makes write-off available.

Why not just run the clock faster: a multiplied clock keeps running when nobody is watching, so a demo deployment left on for a few real days would accrue years of interest and push seeded debts past their limits. A manual fast-forward only moves time when the presenter chooses.

The admin panel has fast-forward buttons (+1 day, +7 days, +30 days, +90 days, "to grace deadline of agent X"). When `demo_offset > 0`, the app header shows a small chip: "Demo clock · 14 Jan 2027 (+81 days)". Real card transactions keep their real timestamps; protocol dates are shown for deals, interest and grace periods.

`advance_pool.protocol_now()` is the single source of truth; the note contract calls it.

---

## 6. Architecture and repository layout

```
explorador-advance/
├── apps/web/                    Next.js app (UI + API routes + ASA responder)
│   ├── app/                     App Router pages (see §10) and app/api/** route handlers
│   ├── lib/                     stellar/, zk/, lithic/, auth/, db/, crypto/, format/
│   ├── prisma/schema.prisma
│   ├── zk/                      cpcv_attestation.wasm, cpcv_attestation_final.zkey, verification_key.json (build outputs, committed)
│   └── public/logo.svg          explorador logo (download from https://explorador.pt/logo.svg)
├── packages/contracts-ts/       TypeScript bindings generated with `stellar contract bindings typescript`
├── contracts/                   Cargo workspace (target wasm32v1-none)
│   ├── teurc/                   SEP-41 test EURC
│   ├── cpcv_note/               SEP-50 soulbound NFT + public registry + Groth16 verifier
│   ├── advance_pool/            SEP-41 shares + SEP-56 senior vault + credit lines + settlement
│   └── shared/                  types, errors, fixed-point math, Groth16 verifier module
├── circuits/
│   ├── cpcv_attestation.circom
│   ├── build.sh                 compile, trusted setup (local ptau, 2^15), export vk + Soroban-formatted vk
│   └── test/                    circuit tests + fixture proof used by Rust tests
├── scripts/                     keys:generate, deploy, seed, demo:reset, lithic:enroll, e2e
├── deployments/testnet.json     contract ids + wasm hashes (written by deploy)
├── docker-compose.yml           Postgres for local dev
├── DECISIONS.md
└── README.md                    setup, run, deploy, demo script
```

Data sources:
- **Live state** (balances, debt, credit, pool stats, notes) is read directly from the contracts via RPC simulation of view functions.
- **History** (card transactions, deposits, settlements, events) comes from Postgres, filled by an event indexer (§9.6).
- **Private data** (CPCV PII) lives only in Postgres, encrypted. It never goes on-chain.

Libraries (use latest stable versions): `@stellar/stellar-sdk`, `@stellar/freighter-api`, `smart-account-kit` (OpenZeppelin smart accounts with passkeys), `@simplewebauthn/server` + `@simplewebauthn/browser`, `snarkjs`, `circomlibjs`, `circomlib` (circuits), `lithic`, `prisma`, `iron-session`, `resend`, `zod`, `recharts`, `lucide-react`, Tailwind CSS v4, shadcn/ui (restyled to §10). Rust: `soroban-sdk` (pin to the latest stable release compatible with current testnet; must expose `crypto::bn254`, i.e. ≥ 25), OpenZeppelin `stellar-tokens`, `stellar-access`, `stellar-macros`, `stellar-contract-utils`, and `soroban-fixed-point-math` for mul-div.

---

## 7. Smart contracts

General rules for all contracts:
- Use `#[contracterror]` enums with explicit codes; never `panic!` with strings in production paths.
- Use `#[contractevent]` for events.
- Extend TTL of persistent entries on every read/write (instance: ~30 days; persistent records: ~90 days, threshold half of that).
- Use checked arithmetic.
- Every privileged function calls `require_auth()` on the right role address.

### 7.1 `teurc` — Test EURC (SEP-41)

OpenZeppelin fungible token (`stellar-tokens` fungible `Base`) with metadata `name = "Test Euro Coin"`, `symbol = "tEURC"`, `decimals = 7`.

```rust
fn __constructor(e: Env, admin: Address);
fn mint(e: Env, to: Address, amount: i128);          // admin only
fn faucet(e: Env, to: Address, amount: i128);        // anyone; amount ≤ 25_000 × 10^7 per call (testnet only)
// + full SEP-41 interface (balance, transfer, transfer_from, approve, allowance, burn, burn_from, decimals, name, symbol)
```

### 7.2 `cpcv_note` — Soulbound CPCV Note (SEP-50) + public registry + Groth16 verifier

**Types**

```rust
#[contracttype] pub struct Groth16Proof { pub a: BytesN<64>, pub b: BytesN<128>, pub c: BytesN<64> }
// a is stored NEGATED (−A) so verification is a single product-of-pairings == 1 check (see §8.5)

#[contracttype] pub struct VerificationKey {
    pub alpha: BytesN<64>, pub beta: BytesN<128>, pub gamma: BytesN<128>, pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,            // length 10 (9 public inputs + 1)
}

#[contracttype] pub enum NoteStatus { Active, Settled, Cancelled }

#[contracttype] pub struct Note {
    pub id: u32,
    pub agent: Address,
    pub total_commission: i128,        // stroops
    pub agent_commission: i128,        // stroops, floor(total/2)
    pub explorador_commission: i128,   // stroops, total − agent
    pub escritura_day: u32,            // days since Unix epoch
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub proof: Groth16Proof,
    pub minted_at: u64,                // protocol clock
    pub status: NoteStatus,
}
```

**Storage**: instance — `admin`, `operator`, `pool` (set once), `attester_ax`, `attester_ay`, `nullifier_secret_commitment` (all `BytesN<32>`), `vk`, `base_uri`, `next_id`. Persistent — `Note(id)`, `NullifierUsed(BytesN<32>)`, `CommitmentUsed(BytesN<32>)`, plus whatever the OpenZeppelin non-fungible module stores for ownership.

**Functions**

```rust
fn __constructor(e: Env, admin: Address, operator: Address,
                 attester_ax: BytesN<32>, attester_ay: BytesN<32>,
                 nullifier_secret_commitment: BytesN<32>,
                 vk: VerificationKey, base_uri: String);
fn set_pool(e: Env, pool: Address);                       // admin, once

fn mint(e: Env, to: Address, proof: Groth16Proof,
        total_commission_cents: u64, escritura_day: u32,
        commitment: BytesN<32>, nullifier: BytesN<32>) -> u32;   // operator
// 1. operator.require_auth()
// 2. reject if NullifierUsed or CommitmentUsed
// 3. agent_field = agent_field(to)                        (§8.4)
// 4. agent_commission_cents = total_commission_cents / 2
// 5. require escritura_day > pool.protocol_now() / 86_400
// 6. public inputs (in this exact order, as Fr):
//    [agent_field, total_commission_cents, agent_commission_cents, escritura_day,
//     commitment, nullifier, attester_ax, attester_ay, nullifier_secret_commitment]
// 7. verify Groth16 (§8.5); on failure → Error::InvalidProof
// 8. store Note (amounts converted to stroops), mark nullifier + commitment used
// 9. mint NFT token id = next_id to `to`
// 10. call pool.open_line(id)
// 11. emit NoteMinted

fn set_status(e: Env, id: u32, status: NoteStatus);      // pool only (pool.require_auth())
fn get(e: Env, id: u32) -> Note;
fn count(e: Env) -> u32;
fn list(e: Env, start: u32, limit: u32) -> Vec<Note>;    // limit ≤ 50
fn notes_of(e: Env, agent: Address) -> Vec<u32>;
fn nullifier_used(e: Env, nullifier: BytesN<32>) -> bool;
fn verification_key(e: Env) -> VerificationKey;
fn agent_field(e: Env, addr: Address) -> BytesN<32>;     // view helper, used by TS parity tests

// SEP-50 surface: balance, owner_of, name ("explorador advance CPCV Note"), symbol ("eaNOTE"),
// token_uri (= base_uri + "/" + id, served by GET /api/registry/[id]/metadata).
// transfer, transfer_from, approve, approve_for_all → always return Error::Soulbound.
```

**Events**: `NoteMinted { id, agent, total_commission, agent_commission, escritura_day, commitment, nullifier }`, `NoteStatusChanged { id, status }`.

### 7.3 `advance_pool` — Senior vault + credit lines + settlement

**Types**

```rust
#[contracttype] pub struct Params {
    pub agent_apr_bps: u32, pub protocol_fee_bps: u32, pub senior_target_bps: u32,
    pub ltv_bps: u32, pub grace_period_secs: u64, pub max_leverage: u32, pub demo_mode: bool,
}
#[contracttype] pub enum LineStatus { Active, Settled, Cancelled }
#[contracttype] pub struct Line {
    pub note_id: u32, pub agent: Address, pub credit_limit: i128,
    pub principal: i128, pub scaled_debt: i128, pub escritura_day: u32, pub status: LineStatus,
}
#[contracttype] pub struct AgentState {
    pub card_balance: i128, pub card_enabled: bool, pub blocked: bool,
    pub active_lines: Vec<u32>,
    pub carried_principal: i128, pub carried_scaled: i128,
    pub grace_deadline: Option<u64>, pub written_off_total: i128,
}
#[contracttype] pub struct LineView { pub line: Line, pub debt: i128, pub interest: i128, pub available: i128 }
#[contracttype] pub struct AgentPosition {
    pub card_balance: i128, pub card_enabled: bool, pub blocked: bool,
    pub lines: Vec<LineView>, pub carried_debt: i128, pub grace_deadline: Option<u64>,
    pub total_debt: i128, pub total_principal: i128, pub available_credit: i128, pub borrowable_now: i128,
}
#[contracttype] pub struct PoolStats {
    pub senior_assets: i128, pub junior_assets: i128, pub fees_accrued: i128,
    pub total_debt: i128, pub total_principal: i128, pub pool_cash: i128, pub total_card_balances: i128,
    pub share_supply: i128, pub share_price_scaled: i128,   // assets per 1 share × SCALE
    pub utilization_bps: u32, pub leverage_x100: u32,       // total_debt / junior × 100
    pub lendable: i128, pub leverage_headroom: i128,
    pub borrow_index: i128, pub protocol_now: u64, pub params: Params,
    pub written_off_total: i128,
}
#[contracttype] pub struct DrawResult { pub from_balance: i128, pub from_credit: i128 }
```

**Storage**: instance — `admin`, `operator`, `treasury`, `card_settlement`, `asset`, `note_contract`, `params`, `demo_offset`, `last_accrual`, `borrow_index`, `total_scaled_debt`, `total_principal`, `senior_assets`, `junior_assets`, `fees_accrued`, `total_card_balances`, `written_off_total`. Persistent — `Line(note_id)`, `Agent(address)`, plus share-token balances/allowances (OpenZeppelin fungible `Base`).

**Functions**

```rust
fn __constructor(e: Env, admin: Address, operator: Address, treasury: Address,
                 card_settlement: Address, asset: Address, note_contract: Address, params: Params);

// ---- SEP-41 share token (eaSR) + SEP-56 TokenizedVault, implemented with the math in §5.5 ----
// total_supply, query_asset, total_assets, convert_to_shares, convert_to_assets,
// max_deposit, preview_deposit, deposit, max_mint, preview_mint, mint,
// max_withdraw, preview_withdraw, withdraw, max_redeem, preview_redeem, redeem
// Emit SEP-56 Deposit / Withdraw events. Use OpenZeppelin fungible Base for share balances,
// but implement the vault math yourself (total_assets is accounting-based, not balance-based).

// ---- clock & accounting ----
fn protocol_now(e: Env) -> u64;
fn advance_clock(e: Env, secs: u64);                       // admin; only if params.demo_mode; accrue() first,
                                                           // then demo_offset += secs (max 400 days per call); emit ClockAdvanced
fn accrue(e: Env);                                         // anyone
fn stats(e: Env) -> PoolStats;
fn params(e: Env) -> Params;

// ---- credit lines ----
fn open_line(e: Env, note_id: u32);                        // note_contract only
//   reads note, credit_limit = agent_commission × ltv_bps / BPS, pushes to agent.active_lines
fn line(e: Env, note_id: u32) -> LineView;
fn agent_position(e: Env, agent: Address) -> AgentPosition;

// ---- card ----
fn enable_card(e: Env, agent: Address);                    // agent.require_auth()  (passkey)
fn disable_card(e: Env, agent: Address);                   // agent.require_auth()
fn card_draw(e: Env, agent: Address, amount: i128, auth_ref: BytesN<32>) -> DrawResult;  // operator
//   requires card_enabled; from_balance = min(card_balance, amount);
//   from_credit = amount − from_balance; if from_credit > 0: require !blocked and
//   from_credit ≤ borrowable_now; allocate across active lines by earliest escritura_day;
//   transfer `amount` of asset to card_settlement; reject duplicate auth_ref (Error::DuplicateDraw)
fn withdraw_balance(e: Env, agent: Address, amount: i128, to: Address);  // agent.require_auth()

// ---- deal outcomes ----
fn settle(e: Env, note_id: u32);                           // operator + treasury auth
//   accrue; pull note.total_commission from treasury;
//   d = debt(line); repay line; c = carried debt; repay = min(agent_commission − d, c) of carried
//   (if agent_commission < d, the shortfall becomes carried debt);
//   card_balance += agent_commission − d − carried_repaid;
//   junior_assets += explorador_commission; line → Settled; note.set_status(Settled);
//   clear grace_deadline if carried debt reaches 0; emit NoteSettled
fn cancel(e: Env, note_id: u32);                           // operator
//   accrue; move line.scaled_debt/principal into agent carried; line → Cancelled;
//   remove from active_lines; repay carried from card_balance as far as possible;
//   if carried > 0 and grace_deadline is None → grace_deadline = now + grace_period_secs;
//   note.set_status(Cancelled); emit NoteCancelled
fn write_off(e: Env, agent: Address);                      // operator; requires now ≥ grace_deadline
//   accrue; loss = carried debt; remove from total_scaled_debt/total_principal;
//   junior_loss = min(loss, junior_assets); senior_loss = loss − junior_loss;
//   agent.blocked = true; written_off_total += loss; emit DebtWrittenOff
fn set_blocked(e: Env, agent: Address, blocked: bool);     // operator

// ---- junior tranche & fees (treasury) ----
fn junior_deposit(e: Env, amount: i128);                   // treasury.require_auth()
fn junior_withdraw(e: Env, amount: i128);                  // treasury; amount ≤ junior_assets, ≤ lendable,
                                                           // and afterwards total_debt ≤ max_leverage × junior_assets
fn claim_fees(e: Env, amount: i128);                       // treasury; amount ≤ min(fees_accrued, pool_cash)
```

**Events**: `CardEnabled { agent, enabled }`, `CardDraw { agent, amount, from_balance, from_credit, auth_ref }`, `LineOpened { note_id, agent, credit_limit }`, `NoteSettled { note_id, agent, total_commission, debt_repaid, interest_paid, carried_repaid, agent_payout, junior_deposit }`, `NoteCancelled { note_id, agent, debt_carried, grace_deadline }`, `DebtWrittenOff { agent, amount, junior_loss, senior_loss }`, `BalanceWithdrawn { agent, amount, to }`, `JuniorDeposit { amount }`, `JuniorWithdraw { amount }`, `FeesClaimed { amount }`, `ClockAdvanced { secs, protocol_now }`, plus SEP-56 `Deposit` / `Withdraw`.

**Errors** (shared numbering): `NotAuthorized`, `AlreadyInitialized`, `InvalidAmount`, `InsufficientCredit`, `InsufficientLiquidity`, `LeverageCapExceeded`, `CardNotEnabled`, `AgentBlocked`, `LineNotActive`, `GraceNotOver`, `NothingToWriteOff`, `DuplicateDraw`, `InvalidProof`, `NullifierUsed`, `CommitmentUsed`, `EscrituraInPast`, `Soulbound`, `UnknownNote`.

### 7.4 Deployment wiring

1. Upload wasm for all three contracts; store wasm hashes in `deployments/testnet.json`.
2. Deploy `teurc(admin)`.
3. Deploy `cpcv_note(admin, operator, attester_ax, attester_ay, nullifier_secret_commitment, vk, base_uri)`.
4. Deploy `advance_pool(admin, operator, treasury, card_settlement, teurc, cpcv_note, params)`.
5. `cpcv_note.set_pool(advance_pool)`.
6. Mint 1,000,000 tEURC to treasury; `junior_deposit(10_000 tEURC)`.
7. Generate TS bindings into `packages/contracts-ts`.

---

## 8. Zero-knowledge circuit

### 8.1 Purpose and trust model (state this in the README and on the registry page)

- **explorador is the attester**: it signs that a real CPCV exists with these terms. The proof does not remove that trust.
- The proof shows publicly, without revealing personal data, that:
  - explorador's attester key signed this exact deal record;
  - the commission was computed correctly from a hidden sale price and a commission rate between 1% and 10%;
  - the agent gets exactly half;
  - the escritura date is after the CPCV date;
  - the record is bound to this specific agent's account (so the note can only go to them);
  - the deal has a unique nullifier, so the same CPCV can never be financed twice.
- Hidden: buyer, seller, their NIFs, sale price, commission rate, property address, CPCV date.
- The commitment lets explorador open the record to an auditor later without changing anything on-chain.

### 8.2 Inputs (`circuits/cpcv_attestation.circom`, Circom 2, circomlib)

Private:

| Signal | Meaning |
|---|---|
| `buyer_nif`, `seller_nif` | 9-digit integers |
| `sale_price_cents` | u64 |
| `commission_rate_bps` | 100…1000 |
| `property_hash` | Poseidon hash of the normalized address (§8.4) |
| `cpcv_day` | days since Unix epoch |
| `salt` | random field element (31 random bytes) |
| `nullifier_secret` | explorador's secret field element (`NULLIFIER_SECRET`) |
| `sig_r8x`, `sig_r8y`, `sig_s` | EdDSA-Poseidon (BabyJubJub) signature |

Public (declare as `component main {public [...]}` in **exactly** this order; no outputs):

```
0 agent_field
1 total_commission_cents
2 agent_commission_cents
3 escritura_day
4 commitment
5 nullifier
6 attester_ax
7 attester_ay
8 nullifier_secret_commitment
```

### 8.3 Constraints

1. Range checks: `sale_price_cents`, `total_commission_cents`, `agent_commission_cents` fit in 64 bits; days fit in 32 bits; `100 ≤ commission_rate_bps ≤ 1000`.
2. Commission: `sale_price_cents × commission_rate_bps == total_commission_cents × 10000 + rem`, with `0 ≤ rem < 10000`.
3. Split: `2 × agent_commission_cents + odd == total_commission_cents`, with `odd ∈ {0,1}`.
4. Dates: `cpcv_day < escritura_day`.
5. `commitment == Poseidon(buyer_nif, seller_nif, sale_price_cents, commission_rate_bps, property_hash, cpcv_day, escritura_day, salt)`.
6. `nullifier == Poseidon(property_hash, buyer_nif, seller_nif, cpcv_day, nullifier_secret)` (independent of the salt, so re-attesting the same deal with a new salt gives the same nullifier; the secret stops anyone brute-forcing low-entropy fields).
7. `nullifier_secret_commitment == Poseidon(nullifier_secret)` (the contract checks this against its stored value, so explorador must always use the same secret).
8. `msg = Poseidon(commitment, agent_field, total_commission_cents, escritura_day, nullifier)`; `EdDSAPoseidonVerifier(enabled=1, Ax=attester_ax, Ay=attester_ay, R8x, R8y, S, M=msg)`.

Expected size: well under 2^15 constraints.

### 8.4 Encodings (must match byte-for-byte in TS, Rust and Circom)

- Field: BN254 scalar field `r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
- `BytesN<32>` field values are **big-endian**.
- `agent_field(addr)`: `h = sha256(addr.to_xdr())` (the XDR of the `ScVal::Address`); `agent_field = 0x00 ‖ h[0..31]` (drop the last byte of the hash, prepend a zero byte). TS: `sha256(nativeToScVal(Address.fromString(c)).toXDR())`. Add a test that compares the TS value with `cpcv_note.agent_field(addr)` on testnet for at least one address.
- `property_hash`: lowercase, trim and collapse whitespace in the address; UTF-8 bytes; split into 31-byte chunks (max 8, zero-padded); `Poseidon(len_bytes, chunk_0 … chunk_7)` using two Poseidon calls if arity requires (`Poseidon(len, c0..c5)` then `Poseidon(prev, c6, c7)`). Off-chain only.
- Days: `floor(unix_seconds / 86400)` in UTC.
- Amounts in the circuit: EUR cents. On-chain: `× 100_000`.

### 8.5 Proof formatting and on-chain verification

- `circuits/build.sh`: `circom --r1cs --wasm --sym`, `snarkjs powersoftau new bn128 15` + contribute + prepare (local; no download), `groth16 setup`, `zkey contribute`, export `verification_key.json`, and run `scripts/vk-to-soroban.ts` to produce the `VerificationKey` struct values and a Rust fixture.
- G1 = 64 bytes `x ‖ y`; G2 = 128 bytes. Check the exact G2 coordinate order expected by `soroban_sdk::crypto::bn254::G2Affine` (CAP-0074) and convert snarkjs output accordingly. **Do not guess: write a Rust unit test that verifies a real snarkjs proof fixture end-to-end in the Soroban test environment; it must pass before anything else is built on top.**
- The TS formatter negates A (`y → p − y`, with p the base-field modulus) before sending, and the contract checks:
  `e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1`, where `vk_x = ic[0] + Σ ic[i+1] · pub[i]` (using `g1_mul` / `g1_add`, then one `pairing_check` with 4 pairs).
- The registry page can re-verify any note in the browser: rebuild the public signals from on-chain data, un-negate A, and call `snarkjs.groth16.verify` with `verification_key.json` (served at `/zk/verification_key.json`).

### 8.6 Server-side proving

- `lib/zk/prove.ts`: build inputs → sign `msg` with `circomlibjs` `eddsa.signPoseidon(ATTESTER_EDDSA_PRIVKEY, msg)` → `snarkjs.groth16.fullProve(input, wasm, zkey)` → `groth16.verify` locally → format for Soroban.
- Bundle `zk/*.wasm` and `zk/*.zkey` with the server function (`outputFileTracingIncludes` in `next.config`). Set `maxDuration = 60` on the route.

---

## 9. Backend

### 9.1 Database (Prisma, Postgres)

```prisma
enum Role { AGENT ADMIN }
enum CpcvStatus { DRAFT PROVING MINTED SETTLED CANCELLED WRITTEN_OFF FAILED }
enum AuthDecision { APPROVED DECLINED }
enum ChainStatus { PENDING SUBMITTED CONFIRMED FAILED }

model User {
  id          String   @id @default(cuid())
  email       String   @unique
  role        Role
  displayName String?
  createdAt   DateTime @default(now())
  passkeys    Passkey[]
  agent       Agent?
}
model EmailCode {
  id         String   @id @default(cuid())
  email      String
  codeHash   String
  expiresAt  DateTime
  consumedAt DateTime?
  attempts   Int      @default(0)
}
model Passkey {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  credentialId  String   @unique   // base64url
  publicKeyCose Bytes
  publicKeyP256 Bytes              // 65-byte uncompressed secp256r1 key, for the smart account
  counter       Int
  transports    String[]
  createdAt     DateTime @default(now())
}
model Agent {
  userId              String  @id
  user                User    @relation(fields: [userId], references: [id])
  smartAccount        String  @unique   // C... address
  agentField          String            // hex, §8.4
  lithicCardToken     String? @unique
  cardLast4           String?
  cardEnabledOnChain  Boolean @default(false)
  signerKind          String  @default("passkey")  // "passkey" | "demo-ed25519" (seed agents)
  cachedPosition      Json?             // last AgentPosition read, for ASA fallback
  cachedAt            DateTime?
  cpcvs               Cpcv[]
  authorizations      CardAuthorization[]
}
model Cpcv {
  id                   String     @id @default(cuid())
  agentId              String
  agent                Agent      @relation(fields: [agentId], references: [userId])
  piiEncrypted         Bytes      // AES-256-GCM JSON: buyer/seller names + NIFs, property address, sale price, rate, cpcv date
  totalCommissionCents BigInt
  agentCommissionCents BigInt
  escrituraDay         Int
  commitment           String     // hex
  nullifier            String     // hex
  proof                Json?      // snarkjs proof + publicSignals
  status               CpcvStatus @default(DRAFT)
  noteId               Int?       @unique
  mintTxHash           String?
  settleTxHash         String?
  cancelTxHash         String?
  error                String?
  createdAt            DateTime   @default(now())
}
model CardAuthorization {
  id                 String       @id @default(cuid())
  lithicToken        String       @unique   // Lithic transaction token (idempotency)
  agentId            String
  agent              Agent        @relation(fields: [agentId], references: [userId])
  amountCents        BigInt
  merchant           String
  decision           AuthDecision
  declineReason      String?
  chainStatus        ChainStatus  @default(PENDING)
  fromBalanceStroops BigInt?
  fromCreditStroops  BigInt?
  txHash             String?
  attempts           Int          @default(0)
  createdAt          DateTime     @default(now())
}
model ChainEvent {
  id        String   @id @default(cuid())
  contract  String
  type      String
  ledger    Int
  txHash    String
  eventIdx  Int
  data      Json
  protocolTs BigInt?
  createdAt DateTime @default(now())
  @@unique([txHash, eventIdx])
}
model PoolSnapshot {
  id            String   @id @default(cuid())
  protocolTs    BigInt
  seniorAssets  BigInt
  juniorAssets  BigInt
  feesAccrued   BigInt
  totalDebt     BigInt
  poolCash      BigInt
  sharePrice    String   // scaled decimal string
  shareSupply   BigInt
  createdAt     DateTime @default(now())
}
model Deployment {
  id          String   @id @default(cuid())
  network     String
  active      Boolean  @default(true)
  teurc       String
  cpcvNote    String
  advancePool String
  wasmHashes  Json
  createdAt   DateTime @default(now())
}
model IndexerCursor { id String @id; lastLedger Int }
```

PII is encrypted with `PII_ENCRYPTION_KEY` (32 bytes, AES-256-GCM) and only decrypted for admins.

### 9.2 Auth

- `POST /api/auth/email/start {email}` → 6-digit code, hashed with SHA-256 + `SESSION_SECRET`, 10-minute expiry, max 5 attempts. Sent with Resend; if `RESEND_API_KEY` is unset, log the code to the server console.
- `POST /api/auth/email/verify {email, code}` → creates the user if new (role ADMIN if email ∈ `ADMIN_EMAILS`, else AGENT) and starts a short "pre-passkey" session.
- Passkey registration: `POST /api/auth/passkey/register/options` and `/verify` with `@simplewebauthn/server`. On verify, store the credential and derive the 65-byte P-256 public key from the COSE key.
  - For agents, the backend then deploys the OpenZeppelin smart account with that key as its WebAuthn signer (via `smart-account-kit`), sponsored by `SPONSOR_SECRET`, and creates the Lithic card. Use **one passkey** for both login and on-chain signing. If `smart-account-kit` insists on creating the credential itself, let it create the passkey and send its registration response to `/verify`; record the approach in `DECISIONS.md`.
- Login: discoverable-credential passkey sign-in (`/api/auth/passkey/login/options` and `/verify`). Email code works as a fallback login.
- Sessions: `iron-session` httpOnly cookie, 7 days. Middleware protects `/agent/**` (AGENT) and `/admin/**` (ADMIN).
- WebAuthn `rpID = WEBAUTHN_RP_ID` (e.g. `localhost` in dev).

### 9.3 Stellar service (`lib/stellar`)

- `readContract(fn, args)`: simulate a view call and decode with the generated bindings.
- `invokeAsOperator(fn, args, extraSigners?)`: build, simulate, assemble, sign with operator (and treasury when needed), submit, poll until `SUCCESS`/`FAILED`, return hash + result. Use a per-key mutex/sequence handling so concurrent card draws don't collide on sequence numbers (serialize operator transactions through a simple Postgres advisory lock).
- Agent passkey transactions: `POST /api/stellar/agent-tx/prepare {action}` builds the tx with `sponsor` as source, simulates, returns the auth entries to sign; the client signs them with the passkey via `smart-account-kit`; `POST /api/stellar/agent-tx/submit` re-simulates, signs as sponsor, submits. Actions: `enable_card`, `disable_card`, `withdraw_balance`.
- `explorerUrl(txHash | contractId)` → `https://stellar.expert/explorer/testnet/...`.

### 9.4 Lithic service (`lib/lithic`)

- Client: `new Lithic({ apiKey: LITHIC_API_KEY, environment: 'sandbox' })`.
- Create card per agent: `cards.create({ type: 'VIRTUAL', memo: agentId, card_program_token: '00000000-0000-0000-1000-000000000000' })` (Visa test BIN). Store token + last4. In sandbox, PAN and CVV can be read from `cards.retrieve` for the "Reveal card" UI.
- `scripts/lithic-enroll.ts`: enroll `${APP_URL}/api/lithic/asa` as the ASA responder endpoint using Lithic's "Enroll responder endpoint" API with type `AUTH_STREAM_ACCESS` (check the exact method name in the current `lithic` Node SDK), then fetch the ASA HMAC secret. Local dev needs a public URL (ngrok or cloudflared); document this.
- Simulate purchase: `transactions.simulateAuthorization({ amount, descriptor, pan })`. Note: sandbox write calls are limited to 1 per second; debounce the button.

### 9.5 ASA responder `POST /api/lithic/asa`

```
verify webhook signature if ASA secret configured (webhook-id / webhook-timestamp / webhook-signature headers)
if exists CardAuthorization(lithicToken = body.token): return the stored decision
status ∈ {AUTHORIZATION, FINANCIAL_AUTHORIZATION}:
  amount = body.amounts?.cardholder?.amount ?? body.amount          // cents, treated as EUR
  agent  = Agent where lithicCardToken = body.card.token            // unknown → SUSPECTED_FRAUD
  if !agent.cardEnabledOnChain → decline CARD_PAUSED
  position = readContract(agent_position) with 1.2 s timeout, else agent.cachedPosition
  stats    = readContract(stats) with the same timeout (or cache)
  spendable = position.card_balance + min(position.available_credit, stats.lendable, stats.leverage_headroom)
              − Σ pending holds (decision APPROVED, chainStatus ∈ {PENDING, SUBMITTED})
  APPROVED if amount×100_000 ≤ spendable else INSUFFICIENT_FUNDS
  insert CardAuthorization in a transaction holding a row lock on the agent
  respond 200 {"result": ...} — total handler time target < 2 s
  after(): if approved → invokeAsOperator(card_draw, [agent, amount×100_000, sha256(token)])
           update row (SUBMITTED → CONFIRMED with split + txHash, or FAILED); refresh cachedPosition
status = BALANCE_INQUIRY: respond APPROVED with balance { amount, available } = spendable in cents
other statuses (credits, reversals): respond APPROVED and record; no on-chain action (out of scope)
```

A retry sweep (`/api/cron/retry-draws`, also triggered on admin page load) retries FAILED/stuck draws up to 3 attempts.

### 9.6 Indexer

- `lib/indexer/sync.ts`: read events for the three contracts from Soroban RPC `getEvents` starting from `IndexerCursor.lastLedger`, decode, upsert `ChainEvent`, update `Cpcv` statuses, then write a `PoolSnapshot` (at most one per real minute).
- Runs **sync-on-read**: public/agent/investor API routes call `syncIfStale(10s)`. Also exposed as `/api/cron/sync` (for Vercel Cron if available) and `pnpm indexer` (long-running loop for local dev).

### 9.7 API routes

| Route | Who | Purpose |
|---|---|---|
| `GET /api/pool/stats` | public | `stats()` + projected/trailing APY + counts of notes by status |
| `GET /api/pool/snapshots?range=7d` | public | share price + TVL series |
| `GET /api/registry?cursor&status` | public | notes (on-chain data + tx hashes) |
| `GET /api/registry/[id]` | public | note detail, events timeline, proof in snarkjs format, public signals |
| `GET /api/registry/[id]/metadata` | public | SEP-50 token metadata JSON (name, description, attributes; no PII) |
| `GET /api/investor/[address]` | public | shares, value, deposits/withdrawals history from events |
| `GET /api/agent/overview` | agent | position, card info, deals, recent transactions |
| `POST /api/agent/card/simulate {amountEur, merchant}` | agent | Lithic simulate authorization |
| `GET /api/agent/card/reveal` | agent | PAN/CVV/expiry (sandbox only) |
| `POST /api/stellar/agent-tx/prepare` / `submit` | agent | passkey-signed actions |
| `POST /api/admin/cpcv` | admin | create + prove + mint pipeline (streams progress via Server-Sent Events) |
| `GET /api/admin/cpcv` / `[id]` | admin | list / detail with decrypted PII |
| `POST /api/admin/cpcv/[id]/settle` | admin | `settle` |
| `POST /api/admin/cpcv/[id]/cancel` | admin | `cancel` |
| `POST /api/admin/agents/[id]/write-off` | admin | `write_off` |
| `POST /api/admin/junior/deposit` / `withdraw` | admin | junior tranche |
| `POST /api/admin/fees/claim` | admin | protocol fees |
| `POST /api/admin/demo/reset` | admin | redeploy from stored wasm hashes + reseed (SSE progress, `maxDuration = 300`) |
| `POST /api/admin/demo/advance-clock {days}` | admin | `advance_clock(days × 86_400)`; only when `DEMO_MODE=true` |
| `POST /api/lithic/asa` | Lithic | ASA responder |
| `POST /api/faucet/teurc {address}` | public | server-side faucet fallback if the investor's Freighter call fails |

Validate every body with `zod`. Return errors as `{ error: { code, message } }`.

---

## 10. Frontend

### 10.1 Design system (match explorador.pt)

Sampled from explorador.pt; replicate this look:

| Token | Value |
|---|---|
| Font | **Sora** (`next/font/google`), weights 400/600/700, antialiased |
| Text | slate-900 `#0f172a`; muted slate-500 `#64748b` |
| Primary | blue-600 `#2563eb`, hover blue-700 `#1d4ed8`; soft blue-100 `#dbeafe` / blue-50 for fills and highlights |
| Page background | white, with **warm off-white sections** (≈ `#f6f5f1`; sample the exact value from the hero of explorador.pt) |
| Dark theme | background `#0b1120`; cards slightly lighter navy; primary blue-500 |
| Top nav | full-width **blue-600 bar**, white logo + "explorador" wordmark followed by a small "advance" pill, white links separated by thin translucent white dividers, avatar / connect button on the right |
| Headlines | Bold, large, **two-tone**: dark first line, key phrase in blue-600 (e.g. "Get paid / **before the escritura.**"). h1 60px/700 (40px mobile), h2 44px/700 letter-spacing −1.1px, h3 24px/700 |
| Eyebrow labels | 12px, uppercase, letter-spacing ~0.2em, slate-500 (e.g. "WHAT IS EXPLORADOR ADVANCE") |
| Buttons | Primary: blue-600, white text, **rounded-xl (12px)**, 600 weight, 14–16px, height ~44px, px-6, label ends with "→" for forward actions. Secondary: white background, blue-600 text |
| Cards | White, **rounded-2xl (16px) or rounded-3xl (24px)**, 1px slate-200/70 border, no heavy shadows; glass variant `bg-white/60` + border for cards over coloured sections |
| Stat pills | Small white card with tiny uppercase label above a big bold tabular number (like "À VENDA AGORA · 375 420" on explorador.pt) |
| Status badges | Active = blue, Settled = emerald, Cancelled = amber, Written off = red, Overdue = orange outline |
| Charts | Recharts, blue-600 lines/areas on light blue fills, no gridline clutter |
| Icons | lucide-react, 1.5px stroke |
| Theme toggle | Light / System / Dark, like the site footer |

Formatting: euros as `€3,750.00` (en-GB style), dates as `14 Jan 2027`, times in Europe/Lisbon. Addresses truncated `CDLZ…4XQA` with a copy button and stellar.expert link. All numbers use `tabular-nums`. Mobile-first for the agent app (agents use it on their phone).

### 10.2 Pages

**`/` Landing (public)**
- Hero: eyebrow "EXPLORADOR ADVANCE"; headline "Close the deal. / **Get paid today.**"; subcopy explaining commission advances for agents and yield for investors; CTAs "I'm an agent →" (`/agent`), "Invest →" (`/invest`), link "See every deal on-chain →" (`/registry`).
- Live stat pills: pool TVL, senior APY (projected), active notes, total advanced.
- "How it works" in three cards (Agents / Investors / explorador) using the worked example in §5.6.
- Trust section: ZK privacy (what's public vs hidden), first-loss protection, Stellar standards used (SEP-41, SEP-50, SEP-56, passkey smart accounts, Protocol 25 BN254 + Poseidon).

**`/agent` Agent app (auth: agent)**
- Onboarding stepper if incomplete: email → passkey → card created → "Activate card" (passkey).
- **Card**: a card visual (blue gradient, explorador logo, last4, "Virtual · Sandbox"), "Reveal details" (PAN/CVV/expiry).
- **Available to spend** (big number) = card balance + borrowable now; below it the breakdown: *Card balance*, *Credit available*, *Debt* (principal + interest, interest ticking live client-side from the index and APR).
- **Simulate purchase** sheet: amount + merchant (preset chips: "Pastelaria Aloma €4.80", "Galp fuel €62.00", "Worten €349.00"). Shows approve/decline result and then the on-chain confirmation with a link.
- **Deals**: one card per note: status badge, commission (agent share), credit limit, used, escritura date with countdown, "Overdue" badge if past; link to the registry entry.
- **Activity**: card transactions (merchant, amount, "from balance €x / on credit €y", status, tx link), settlements ("Deal #12 settled: €4,411.23 added"), cancellations.
- Carried-debt banner when present: amount, grace deadline countdown, explanation.
- Settings: email, passkeys, smart account address (under "Advanced"), "Withdraw balance to my account" (passkey).

**`/invest` Investor dashboard (Freighter)**
- Connect Freighter (check testnet; prompt to switch if not). Helpers: "Get test XLM" (Friendbot), "Get 10,000 tEURC".
- Position: shares (eaSR), current value, deposited, earned, share price.
- Deposit / Withdraw panel with previews (`preview_deposit`, `preview_withdraw`, `max_withdraw`) and "Available liquidity now".
- **Pool health**: TVL; senior assets; junior (first-loss) assets and coverage `junior / (senior + junior)`; outstanding debt; utilization; leverage `debt / junior` vs 10× cap (progress bar); idle liquidity; target APY 8%, projected APY, 7-day trailing APY; protocol fees accrued; total written off; notes by status.
- Charts: share price over time; TVL vs debt.
- Explainer: "How your yield works" (waterfall diagram: interest → 10% fee → senior up to 8% → junior; losses → junior first).

**`/admin` Admin panel (auth: admin)**
- Dashboard: pool stats, junior tranche (deposit/withdraw), fees (claim), alerts (failed card draws, agents past grace).
- **New CPCV** form (§4.3) with the live split preview and the step-by-step pipeline progress.
- CPCVs table: agent, property (decrypted), total commission, escritura date, status, note link; row actions **Confirm escritura**, **Cancel (buyer withdrew)**, view proof.
- Agents table: email, smart account, card, notes, debt, carried debt, grace deadline, blocked; action **Write off** (enabled only after the deadline).
- Demo: "Reset demo" (redeploy + seed, with progress log), current deployment ids, demo clock with fast-forward buttons (§5.7).

**`/registry` Public registry**
- Header: "Every deal, on-chain. **No personal data.**" + counts by status + the trust-model explainer (§8.1).
- Table: Note #, agent address, total commission, agent commission, credit limit, escritura date, status, minted (date + tx link). Filters by status; search by note id or agent address.
- **`/registry/[id]`**: all public fields, commitment, nullifier, proof (A/B/C hex, collapsible), public signals, timeline of events (minted, draws total, settled/cancelled/written off), and a **"Verify proof in your browser"** button that runs `snarkjs.groth16.verify` and shows a green check. Clearly list what is hidden.

Shared: header with nav (Registry, Invest, Agent, Admin when admin), demo-clock chip, theme toggle; footer like explorador.pt with "Testnet demo · not financial advice".

---

## 11. Seed data, deployment and configuration

### 11.1 Scripts

| Command | Does |
|---|---|
| `pnpm keys:generate` | Creates admin/operator/treasury/card-settlement/sponsor keypairs, funds them with Friendbot, generates the BabyJubJub attester key, `NULLIFIER_SECRET`, `PII_ENCRYPTION_KEY`, `SESSION_SECRET`; writes `.env.local` |
| `pnpm circuits:build` | §8.5 |
| `pnpm contracts:build` / `contracts:test` | `stellar contract build`, `cargo test` |
| `pnpm deploy:testnet` | §7.4, writes `deployments/testnet.json` and a `Deployment` row, generates TS bindings |
| `pnpm seed` | Demo data (below) |
| `pnpm demo:reset` | Redeploy from stored wasm hashes + seed (same code as the admin button) |
| `pnpm lithic:enroll` | Enroll ASA endpoint |
| `pnpm indexer` | Long-running indexer for local dev |
| `pnpm e2e` | Full flow on testnet (§12) |
| `pnpm dev` | Next.js dev server |

### 11.2 Seed data

Deploy with `DEMO_MODE=true`. The seed builds history by fast-forwarding the protocol clock between steps (e.g. mint → draws → +60 days → settle). Since the offset is global, each note's escritura date must be set relative to the protocol date at the moment it is minted, and the seed should finish with the active notes' escrituras still 30–90 protocol days in the future.
- Admin user from the first email in `ADMIN_EMAILS`.
- Three seed agents (Ana Costa, Bruno Ferreira, Carla Mendes; emails `ana@demo.explorador.pt` etc.). Their smart accounts use a server-held **Ed25519 demo signer** (`signerKind = "demo-ed25519"`) because passkeys can't be created by a script; they can log in with the email code. Each gets a Lithic card and `enable_card`.
- Two investors (generated keys, funded): deposits of 40,000 and 25,000 tEURC.
- Five CPCVs with realistic Portuguese data (Lisboa, Porto, Braga, Cascais, Faro; prices €185k–€620k; rates 4–5%):
  1. Ana — active, ~70% of the credit used through 4–5 card draws.
  2. Bruno — active, lightly used.
  3. Carla — settled (shows debt repaid, junior top-up, card balance).
  4. Bruno — cancelled, carried debt in grace.
  5. Ana — settled earlier, with card-balance spends afterwards.
- Seed card spends are recorded by calling `card_draw` directly and inserting `CardAuthorization` rows with merchant names (do not depend on the ASA endpoint being reachable).

### 11.3 Environment variables

```
DATABASE_URL=
APP_URL=http://localhost:3000
SESSION_SECRET=
ADMIN_EMAILS=you@explorador.pt
RESEND_API_KEY=            # optional in dev (codes logged to console)
EMAIL_FROM="explorador advance <advance@explorador.pt>"
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME="explorador advance"

STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
ADMIN_SECRET=
OPERATOR_SECRET=
TREASURY_SECRET=
CARD_SETTLEMENT_PUBLIC=
SPONSOR_SECRET=
DEMO_MODE=true

ATTESTER_EDDSA_PRIVKEY=
NULLIFIER_SECRET=
PII_ENCRYPTION_KEY=

LITHIC_API_KEY=            # sandbox key
LITHIC_ASA_HMAC_SECRET=    # filled by lithic:enroll
```

Contract ids are read from the active `Deployment` row (falling back to `deployments/testnet.json`), so a demo reset doesn't require changing env vars.

### 11.4 Hosting

- Local: `docker compose up -d` (Postgres 16), `pnpm dev`, a tunnel for the ASA endpoint.
- Production demo: Vercel (Next.js) + Neon Postgres. Note in the README that Stellar testnet is reset periodically; after a reset run `pnpm demo:reset`.

---

## 12. Testing and acceptance criteria

### 12.1 Required tests

- **Rust**
  - Groth16: verify the committed snarkjs fixture proof (must pass); reject a tampered public input; reject a tampered proof.
  - `cpcv_note`: mint happy path; duplicate nullifier; duplicate commitment; wrong attester key; wrong `nullifier_secret_commitment`; escritura in the past; mint to a different address than the one in the proof fails; soulbound (transfer/approve fail).
  - `advance_pool`: deposit/withdraw/redeem math; accrual against the worked example (§5.6): draw €3,000, fast-forward 90 days with no other activity, settle → interest €88.77 and payout €4,411.23 (within €0.01); the same with 90 daily accruals → ≈ €90.08; draw order (balance first, then earliest escritura); credit limit; leverage cap; liquidity cap; settle with and without carried debt; settle when debt exceeds the agent's half; cancel → grace → write-off with junior absorbing first and senior only after junior is exhausted; blocked agent; duplicate `auth_ref`; **invariant fuzz test** (§5.3) over ≥ 500 random operations; `advance_clock` (only in demo mode, admin only, monotonic, accrues first).
- **Circuit**: valid witness; each constraint violated individually fails (rate out of range, wrong split, wrong commitment, bad signature, escritura before CPCV).
- **TypeScript**: `agent_field` parity with the contract; `property_hash` determinism; proof formatting round-trip (negate/un-negate A); ASA handler decisions (approve, insufficient, idempotent retry, unknown card); interest display math.
- **E2E (`pnpm e2e`, testnet)**: deploy fresh → investor deposit → create agent (demo signer) → enable card → create CPCV → mint → simulate Lithic purchase (if `LITHIC_API_KEY` is set; otherwise call `card_draw` directly) → settle → assert balances, junior top-up and share price increase → second CPCV → cancel → `advance_clock` past the grace deadline → write off → assert junior loss.

### 12.2 Acceptance checklist

- [ ] A fresh clone builds with the README steps.
- [ ] Contracts deployed on testnet; ids in `deployments/testnet.json`.
- [ ] Admin can create a CPCV and see a note minted with a real on-chain Groth16 verification (tx link).
- [ ] The registry shows the note with no personal data, and "Verify proof in your browser" succeeds.
- [ ] A new agent signs up with email + passkey, never sees a wallet, gets a card and activates it with one passkey prompt.
- [ ] A simulated Lithic purchase is approved via ASA and a `CardDraw` appears on-chain within ~10 s.
- [ ] A purchase larger than spendable is declined with `INSUFFICIENT_FUNDS`.
- [ ] Investors can deposit/withdraw with Freighter and see projected/trailing APY and pool health.
- [ ] Settling repays debt + interest, credits the agent's card balance and grows the junior tranche; share price rises.
- [ ] Cancelling moves debt to carried; write-off after the grace period reduces junior first.
- [ ] The design is recognisably explorador.pt (Sora, blue nav bar, two-tone headlines, rounded white cards), in light and dark mode, and works at phone width.
- [ ] "Reset demo" restores the seeded state.

---

## 13. Security notes, out of scope, stretch goals

**Security notes (document in README)**
- Trust model as in §8.1: explorador attests deals; ZK protects privacy and enforces internal consistency and uniqueness.
- The operator can draw on an agent's credit only after the agent enabled the card with their passkey, and only up to the agent's credit; funds always go to the fixed `card_settlement` address.
- Agent funds in the card balance can be withdrawn by the agent at any time with their passkey.
- Senior share price is accounting-based, so donations cannot manipulate it.
- Keys are testnet-only; never reuse them.

**Out of scope (mention as "path to production" in the README)**
- Real Circle EURC, SEP-24 anchors and EUR off-ramp to IBAN.
- KYC/AML, licensing (credit intermediation and card issuing need a licensed EU partner; Lithic is used in sandbox only).
- EU card issuance, partial approvals, clearing adjustments, refunds/chargebacks on-chain.
- Withdrawal queue for investors when liquidity is low.
- Credit scoring / dynamic LTV, escritura delay handling.
- Mainnet deployment and audits.

**Stretch goals (only after everything above works)**
1. Keep an on-chain **Poseidon Merkle root** of all commitments in `cpcv_note` (using the Protocol 25 Poseidon host functions), so an auditor can prove a deal's inclusion.
2. Replace the operator's `enable_card` consent with an **OpenZeppelin smart-account context rule / policy**: a backend Ed25519 session signer allowed to call only `card_draw` with a daily limit.
3. Accept qualified electronic signatures (Chave Móvel Digital) on the CPCV as an additional attestation.

---

## 14. Demo script (5 minutes)

1. **Registry & pool** (`/registry`, `/invest`): "Every deal is on-chain, with no personal data. Investors earn yield from agents' advances, protected by explorador's first-loss capital."
2. **Investor**: connect Freighter, get 10,000 tEURC, deposit 5,000, show the shares.
3. **Admin**: create a CPCV for a live agent (€300,000, 5%, escritura in 90 days). Watch the pipeline: attestation → ZK proof → on-chain verification → note minted. Open it in the registry and verify the proof in the browser.
4. **Agent (phone)**: available to spend €3,750. Simulate "Pastelaria Aloma €4.80" and "Worten €349.00": approved by the card network flow, borrowed on Stellar in seconds; debt and interest tick up.
5. **Escritura**: admin confirms. The agent's debt disappears, €4,411.23-style payout lands on the card balance, explorador's €7,500 goes into the first-loss tranche, the share price moves up.
6. **What if the buyer walks away?** Cancel a deal: debt is carried and the grace countdown starts. Fast-forward 180 days, write off: junior absorbs the loss while senior investors are untouched.
