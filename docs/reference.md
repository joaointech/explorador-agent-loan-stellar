# Reference

The contract interface, events, error codes, pages and API routes, as built. Where the build differs from [`spec.md`](../spec.md) §7 and §9.7, the reason is in [`DECISIONS.md`](../DECISIONS.md). Units: on-chain amounts are i128 **stroops** of tEURC (7 decimals); JSON APIs send amounts as decimal strings of stroops; inputs typed by people are euros.

## Contracts

All three contracts use soroban-sdk 28, with OpenZeppelin `stellar-tokens` 0.8 for the token surfaces. Every privileged function calls `require_auth()` on its role. Instance storage is extended to about 30 days on every call, and persistent records to about 90 days.

### `teurc`: Test Euro Coin (SEP-41)

| Function | Who | Notes |
|---|---|---|
| `__constructor(admin)` | deploy | `name` "Test Euro Coin", `symbol` "tEURC", 7 decimals |
| `mint(to, amount)` | admin | |
| `faucet(to, amount)` | anyone | at most 25,000 tEURC per call (testnet only) |
| SEP-41 | | `balance`, `transfer`, `transfer_from`, `approve`, `allowance`, `burn`, `burn_from`, `decimals`, `name`, `symbol` |

### `cpcv_note`: soulbound CPCV Note (SEP-50), public registry, Groth16 verifier

| Function | Who | Notes |
|---|---|---|
| `__constructor(admin, operator, attester_ax, attester_ay, nullifier_secret_commitment, vk, base_uri)` | deploy | rejects a VK without 10 IC points or non-canonical attester parameters |
| `set_pool(pool)` | admin, once | |
| `mint(to, proof, total_commission_cents, escritura_day, commitment, nullifier) -> u32` | operator | Rejects a used nullifier or commitment and an escritura not after the protocol day. Builds the 9 public inputs (`agent_field(to)`, total, agent half, escritura day, commitment, nullifier, attester key, nullifier-secret commitment), verifies Groth16 on BN254 (`e(−A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) = 1`), stores the note (amounts in stroops) and mints token id = note id. Then calls `advance_pool.open_line(note)`, passing the note by value because Soroban forbids re-entry. Ids start at 1. |
| `set_status(id, status)` | the pool | sets `Settled` / `Cancelled`; no transition checks (the pool owns the state machine) |
| `get(id)`, `count()`, `list(start, limit ≤ 50)`, `notes_of(agent)`, `nullifier_used(nullifier)` | view | |
| `verification_key()`, `attester_params()`, `agent_field(addr)` | view | `attester_params` lets anyone rebuild public inputs 6–8 from chain data |
| SEP-50 | | `balance`, `owner_of`, `get_approved`, `is_approved_for_all`, `name` ("explorador advance CPCV Note"), `symbol` ("eaNOTE"), `token_uri` = `base_uri + "/" + id` (`base_uri` = `${APP_URL}/api/notes`, fixed at deploy). `transfer`, `transfer_from`, `approve`, `approve_for_all` always fail with `Soulbound` (#17). |

### `advance_pool`: senior vault, junior tranche, credit lines, settlement

| Function | Who | Notes |
|---|---|---|
| `__constructor(admin, operator, treasury, card_settlement, asset, note_contract, params)` | deploy | `params`: 1200 / 1000 / 800 / 5000 bps, 180-day grace, 10× leverage, `demo_mode` |
| SEP-41 share token `eaSR` | | `balance`, `transfer`, `transfer_from`, `approve`, `allowance`, `burn`, `burn_from`, `decimals`, `name`, `symbol`, `total_supply` |
| SEP-56 vault | | `query_asset`, `total_assets` (= booked senior assets, not the token balance), `convert_to_shares`, `convert_to_assets`, `max_deposit`, `preview_deposit`, `deposit`, `max_mint`, `preview_mint`, `mint`, `max_withdraw`, `preview_withdraw`, `withdraw`, `max_redeem`, `preview_redeem`, `redeem`. Withdrawals are capped by lendable cash. |
| `protocol_now()` | view | ledger time + demo offset; the single clock for every contract |
| `advance_clock(secs)` | admin, demo mode only | accrues first, then adds to the offset; at most 400 days per call; monotonic |
| `accrue()` | anyone | |
| `stats()`, `params()`, `line(note_id)`, `agent_position(agent)` | view | views preview accrual, so numbers are always current |
| `open_line(note)` | `cpcv_note` | `credit_limit = agent_commission × ltv_bps / 10,000` |
| `enable_card(agent)`, `disable_card(agent)` | the agent (passkey) | the agent's consent for card draws |
| `card_draw(agent, amount, auth_ref) -> DrawResult` | operator | card balance first, then credit (earliest escritura first) up to `borrowable_now`; pays `card_settlement`; a duplicate `auth_ref` fails |
| `withdraw_balance(agent, amount, to)` | the agent | |
| `settle(note_id)` | operator + treasury | pulls the total commission from the treasury; repays line debt, then carried debt; the rest of the agent's half goes to the card balance and explorador's half to junior |
| `cancel(note_id)` | operator | line debt becomes carried debt, repaid from the card balance as far as possible; starts the 180-day grace period unless one is already running |
| `write_off(agent)` | operator, after the grace deadline | the loss is charged to junior, then senior (then unclaimed fees if both are empty); the agent is blocked |
| `set_blocked(agent, blocked)` | operator | |
| `junior_deposit(amount)`, `junior_withdraw(amount)`, `claim_fees(amount)` | treasury | withdrawals respect lendable cash and the leverage cap; fees ≤ accrued and ≤ pool cash |

### Events

The first topic is the snake_case event name; fields go in the data map.

| Contract | Events |
|---|---|
| `cpcv_note` | `note_minted { id, agent, total_commission, agent_commission, escritura_day, commitment, nullifier }`, `note_status_changed { id, status }`, plus OpenZeppelin's `mint` |
| `advance_pool` | `card_enabled { agent, enabled }`, `card_draw { agent, amount, from_balance, from_credit, auth_ref }`, `line_opened { note_id, agent, credit_limit }`, `note_settled { note_id, agent, total_commission, debt_repaid, interest_paid, carried_repaid, agent_payout, junior_deposit }`, `note_cancelled { note_id, agent, debt_carried, grace_deadline }`, `debt_written_off { agent, amount, junior_loss, senior_loss }`, `balance_withdrawn { agent, amount, to }`, `junior_deposit { amount }`, `junior_withdraw { amount }`, `fees_claimed { amount }`, `clock_advanced { secs, protocol_now }`, SEP-56 `deposit` / `withdraw`, SEP-41 token events |
| `teurc` | SEP-41 token events (`mint`, `transfer`, `approve`, `burn`) |

### Error codes (shared numbering)

| # | Error | # | Error | # | Error |
|---|---|---|---|---|---|
| 1 | NotAuthorized | 9 | LineNotActive | 17 | Soulbound |
| 2 | AlreadyInitialized | 10 | GraceNotOver | 18 | UnknownNote |
| 3 | InvalidAmount | 11 | NothingToWriteOff | 19 | DemoModeDisabled |
| 4 | InsufficientCredit | 12 | DuplicateDraw | 20 | ClockAdvanceTooLarge |
| 5 | InsufficientLiquidity | 13 | InvalidProof | 21 | Overflow |
| 6 | LeverageCapExceeded | 14 | NullifierUsed | 22 | PoolNotSet |
| 7 | CardNotEnabled | 15 | CommitmentUsed | | |
| 8 | AgentBlocked | 16 | EscrituraInPast | | |

The API maps contract errors to `{ error: { code, message } }`, with SCREAMING_SNAKE codes such as `DUPLICATE_DRAW` or `GRACE_NOT_OVER`.

## Pages

| Route | Access | What |
|---|---|---|
| `/` | public | Landing: live pool numbers, how it works (the worked example), trust section |
| `/registry`, `/registry/[id]` | public | Every note with public data only; note detail with "Verify proof in your browser" |
| `/invest` | public, Freighter | Investor dashboard: faucet helpers, position, deposit / withdraw, pool health, charts, yield explainer |
| `/agent` | agent | Agent app: onboarding, card, available to spend, simulate purchase, deals, activity, settings |
| `/admin`, `/admin/cpcvs/new`, `/admin/cpcvs`, `/admin/agents`, `/admin/demo` | admin | Overview and treasury, New CPCV pipeline, CPCVs, agents and write-off, demo clock and Reset demo |
| `/login` | public | Email code and passkey sign-in |
| `/agent/preview` | agent session; dev or `DEMO_MODE` | Every agent-app state from fixtures |
| `/invest/preview?state=…` | public, noindex | Every investor-dashboard state from fixtures |
| `/design` | public | Design-system reference |

`proxy.ts` redirects signed-out visitors of `/agent/**` and `/admin/**` to `/login?next=…`. Pages and API routes re-check the session against the database.

## API routes

Errors are `{ "error": { "code", "message" } }`. State-changing routes accept only `Content-Type: application/json`.

### Public

| Route | Purpose |
|---|---|
| `GET /api/config` | Active deployment (contract ids, RPC, passphrase), `demoMode`, `lithicEnabled` |
| `GET /api/pool/stats` | `stats()` + projected and trailing APY + notes by status + total advanced + demo clock |
| `GET /api/pool/snapshots?range=7d\|30d\|all` | Share price and TVL series |
| `GET /api/registry?cursor&status&q&limit` | Notes, newest first; `q` = note id or agent address; counts by status |
| `GET /api/registry/[id]` | Note detail: public fields, events timeline, proof in snarkjs format, public signals |
| `GET /api/registry/[id]/metadata`, `GET /api/notes/[id]` | SEP-50 metadata (no personal data); `/api/notes/[id]` is what `token_uri` points at |
| `GET /api/investor/[address]` | Shares, value, deposited, withdrawn, earned, history |
| `POST /api/faucet/teurc` `{ address }` | 10,000 tEURC, operator-signed, once per address per minute (Freighter fallback) |
| `GET /api/cron/sync` | One indexer pass (idempotent) |

### Auth

| Route | Purpose |
|---|---|
| `POST /api/auth/email/start` `{ email }` | Sends a 6-digit code; returns `demoCode` for seeded demo accounts while `DEMO_MODE` is on |
| `POST /api/auth/email/verify` `{ email, code }` | Signs in (creates the user; role from `ADMIN_EMAILS`) |
| `POST /api/auth/passkey/register/options`, `…/register/verify` | Passkey registration; for agents also provisions the smart account and card |
| `POST /api/auth/passkey/provision` | Agent: retries a failed provisioning step (idempotent) |
| `POST /api/auth/passkey/login/options`, `…/login/verify` | Discoverable passkey sign-in |
| `GET /api/auth/session`, `DELETE /api/auth/session` | Current user; sign out |

### Agent

| Route | Purpose |
|---|---|
| `GET /api/agent/overview` | Position, card, deals, activity, rates (syncs the indexer first) |
| `POST /api/agent/card/simulate` `{ amountEur, merchant }` | Purchase through Lithic sandbox or the simulated network |
| `GET /api/agent/card/authorizations/[id]` | Status of one purchase (approval, on-chain draw, tx hash) |
| `GET /api/agent/card/reveal` | PAN, CVV and expiry (sandbox; fake data on the simulated network) |
| `POST /api/stellar/agent-tx/prepare`, `…/submit` | Passkey-signed `enable_card`, `disable_card`, `withdraw_balance`; the sponsor pays |

### Admin

| Route | Purpose |
|---|---|
| `GET /api/admin/overview` | Pool stats, junior, fees, alerts; kicks the card-draw retry sweep |
| `GET /api/admin/cpcv`, `POST /api/admin/cpcv` | List with decrypted data; create + prove + mint, streaming progress as Server-Sent Events |
| `GET /api/admin/cpcv/[id]` | Detail: decrypted record, proof, live line and position |
| `POST /api/admin/cpcv/[id]/settle`, `…/cancel` | Confirm escritura; cancel (buyer withdrew) |
| `GET /api/admin/agents`, `POST /api/admin/agents/[id]/write-off` | Agents with positions; write-off after the grace deadline |
| `POST /api/admin/junior/deposit`, `…/junior/withdraw`, `…/fees/claim` `{ amountEur }` | Treasury operations |
| `POST /api/admin/demo/advance-clock` `{ days }` or `{ toGraceDeadlineOf }` | Demo clock fast-forward (`DEMO_MODE` only) |
| `POST /api/admin/demo/reset` | Redeploy + reseed, streaming progress as Server-Sent Events (`DEMO_MODE` only, up to 300 s) |
| `GET\|POST /api/cron/retry-draws` | Retries failed or stuck card draws (admin session or `Authorization: Bearer $CRON_SECRET`) |

### Card network

| Route | Purpose |
|---|---|
| `POST /api/lithic/asa` | Lithic Auth Stream Access responder: Standard Webhooks signature check once `LITHIC_ASA_HMAC_SECRET` is set; idempotent on the Lithic transaction token |
