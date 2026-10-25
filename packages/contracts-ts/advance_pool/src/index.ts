import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * Credit line backed by one CPCV Note.
 */
export interface Line {
  agent: string;
  /**
 * agent_commission × ltv_bps / BPS (rounded down).
 */
credit_limit: i128;
  /**
 * Days since the Unix epoch; earliest escritura is drawn first.
 */
escritura_day: u32;
  note_id: u32;
  /**
 * Amount drawn and not yet repaid.
 */
principal: i128;
  /**
 * Debt in borrow-index units: debt = ceil(scaled_debt × borrow_index / SCALE).
 */
scaled_debt: i128;
  status: LineStatus;
}


/**
 * Protocol parameters, fixed at deploy (spec §5.1).
 */
export interface Params {
  /**
 * Agent APR on drawn balances (1200 = 12%).
 */
agent_apr_bps: u32;
  /**
 * Enables `advance_clock` (spec §5.7).
 */
demo_mode: boolean;
  /**
 * Grace period before carried debt can be written off.
 */
grace_period_secs: u64;
  /**
 * Credit limit as a share of the agent commission (5000 = 50%).
 */
ltv_bps: u32;
  /**
 * Total debt ≤ max_leverage × junior assets.
 */
max_leverage: u32;
  /**
 * Share of interest that goes to explorador (1000 = 10%).
 */
protocol_fee_bps: u32;
  /**
 * Senior tranche APY target (800 = 8%).
 */
senior_target_bps: u32;
}


export interface LineView {
  /**
 * max(0, credit_limit − debt) for active lines, 0 otherwise.
 */
available: i128;
  /**
 * Current debt (rounded up).
 */
debt: i128;
  /**
 * debt − principal.
 */
interest: i128;
  line: Line;
}


export interface PoolStats {
  borrow_index: i128;
  fees_accrued: i128;
  junior_assets: i128;
  lendable: i128;
  leverage_headroom: i128;
  /**
 * total_debt / junior_assets × 100.
 */
leverage_x100: u32;
  params: Params;
  /**
 * asset.balance(pool) − total_card_balances.
 */
pool_cash: i128;
  protocol_now: u64;
  senior_assets: i128;
  /**
 * Assets per 1 share × SCALE: (senior_assets + 1) × SCALE / (supply + 1).
 */
share_price_scaled: i128;
  share_supply: i128;
  total_card_balances: i128;
  total_debt: i128;
  total_principal: i128;
  /**
 * total_debt / (total_debt + lendable), in bps.
 */
utilization_bps: u32;
  written_off_total: i128;
}


export interface DrawResult {
  from_balance: i128;
  from_credit: i128;
}

export type LineStatus = {tag: "Active", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void};


export interface AgentPosition {
  /**
 * blocked ? 0 : max(0, Σ line available − carried debt).
 */
available_credit: i128;
  blocked: boolean;
  /**
 * min(available_credit, lendable, leverage_headroom).
 */
borrowable_now: i128;
  card_balance: i128;
  card_enabled: boolean;
  carried_debt: i128;
  grace_deadline: Option<u64>;
  /**
 * Active lines in draw order.
 */
lines: Array<LineView>;
  /**
 * Debt on active lines + carried debt.
 */
total_debt: i128;
  total_principal: i128;
}













/**
 * A soulbound CPCV Note (spec §7.2). Amounts are stroops.
 */
export interface Note {
  agent: string;
  /**
 * floor(total_commission / 2)
 */
agent_commission: i128;
  commitment: Buffer;
  /**
 * Days since the Unix epoch.
 */
escritura_day: u32;
  /**
 * total_commission − agent_commission
 */
explorador_commission: i128;
  id: u32;
  /**
 * Protocol clock (unix seconds).
 */
minted_at: u64;
  nullifier: Buffer;
  proof: Groth16Proof;
  status: NoteStatus;
  total_commission: i128;
}

export type NoteStatus = {tag: "Active", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void};


/**
 * Groth16 proof over BN254. `a` is stored NEGATED (−A) so verification is a
 * single product-of-pairings == 1 check (spec §8.5). G1 = 64 bytes, G2 = 128.
 */
export interface Groth16Proof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}

/**
 * Shared error numbering for all explorador advance contracts (spec §7.3).
 * Append new variants at the end; never renumber existing ones.
 */
export const Errors = {
  1: {message:"NotAuthorized"},
  2: {message:"AlreadyInitialized"},
  3: {message:"InvalidAmount"},
  4: {message:"InsufficientCredit"},
  5: {message:"InsufficientLiquidity"},
  6: {message:"LeverageCapExceeded"},
  7: {message:"CardNotEnabled"},
  8: {message:"AgentBlocked"},
  9: {message:"LineNotActive"},
  10: {message:"GraceNotOver"},
  11: {message:"NothingToWriteOff"},
  12: {message:"DuplicateDraw"},
  13: {message:"InvalidProof"},
  14: {message:"NullifierUsed"},
  15: {message:"CommitmentUsed"},
  16: {message:"EscrituraInPast"},
  17: {message:"Soulbound"},
  18: {message:"UnknownNote"},
  /**
   * `advance_clock` called while `params.demo_mode` is false.
   */
  19: {message:"DemoModeDisabled"},
  /**
   * `advance_clock` above the 400-day per-call cap.
   */
  20: {message:"ClockAdvanceTooLarge"},
  /**
   * Checked arithmetic overflowed.
   */
  21: {message:"Overflow"},
  /**
   * `cpcv_note.set_pool` not called yet.
   */
  22: {message:"PoolNotSet"}
}







export const FungibleTokenError = {
  /**
   * Indicates an error related to the current balance of account from which
   * tokens are expected to be transferred.
   */
  100: {message:"InsufficientBalance"},
  /**
   * Indicates a failure with the allowance mechanism when a given spender
   * doesn't have enough allowance.
   */
  101: {message:"InsufficientAllowance"},
  /**
   * Indicates an invalid value for `live_until_ledger` when setting an
   * allowance.
   */
  102: {message:"InvalidLiveUntilLedger"},
  /**
   * Indicates an error when an input that must be >= 0
   */
  103: {message:"LessThanZero"},
  /**
   * Indicates an overflow or underflow in an arithmetic operation
   */
  104: {message:"MathOverflow"},
  /**
   * Indicates access to uninitialized metadata
   */
  105: {message:"UnsetMetadata"},
  /**
   * Indicates that the operation would have caused `total_supply` to exceed
   * the `cap`.
   */
  106: {message:"ExceededCap"},
  /**
   * Indicates the supplied `cap` is not a valid cap value.
   */
  107: {message:"InvalidCap"},
  /**
   * Indicates the Cap was not set.
   */
  108: {message:"CapNotSet"},
  /**
   * Indicates the SAC address was not set.
   */
  109: {message:"SACNotSet"},
  /**
   * Indicates a SAC address different than expected.
   */
  110: {message:"SACAddressMismatch"},
  /**
   * Indicates a missing function parameter in the SAC contract context.
   */
  111: {message:"SACMissingFnParam"},
  /**
   * Indicates an invalid function parameter in the SAC contract context.
   */
  112: {message:"SACInvalidFnParam"},
  /**
   * The user is not allowed to perform this operation
   */
  113: {message:"UserNotAllowed"},
  /**
   * The user is blocked and cannot perform this operation
   */
  114: {message:"UserBlocked"}
}

export interface Client {
  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a line transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  line: ({note_id}: {note_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<LineView>>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mints exactly `shares` to `receiver` for `preview_mint(shares)` assets.
   */
  mint: ({shares, receiver, from, operator}: {shares: i128, receiver: string, from: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a stats transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  stats: (options?: MethodOptions) => Promise<AssembledTransaction<Result<PoolStats>>>

  /**
   * Construct and simulate a accrue transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Books accrued interest (anyone).
   */
  accrue: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The buyer walked away (operator): the line debt moves to the agent's
   * carried debt, the card balance repays it as far as possible, and the
   * grace period starts (if not already running).
   */
  cancel: ({note_id}: {note_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a params transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  params: (options?: MethodOptions) => Promise<AssembledTransaction<Params>>

  /**
   * Construct and simulate a redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burns exactly `shares` of `owner` and pays `preview_redeem(shares)` to
   * `receiver`.
   */
  redeem: ({shares, receiver, owner, operator}: {shares: i128, receiver: string, owner: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Escritura (operator + treasury): pulls the total commission from the
   * treasury, repays the line, then carried debt, credits the rest of the
   * agent's half to the card balance and explorador's half to the junior
   * tranche. If the line debt exceeds the agent's half, the shortfall
   * becomes carried debt.
   */
  settle: ({note_id}: {note_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve: ({owner, spender, amount, live_until_ledger}: {owner: string, spender: string, amount: i128, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deposits `assets` from `from` and mints eaSR to `receiver`.
   * `operator` authorizes; when it is not `from`, it spends `from`'s tEURC
   * allowance (SEP-56 / OpenZeppelin semantics).
   */
  deposit: ({assets, receiver, from, operator}: {assets: i128, receiver: string, from: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a max_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_mint: ({receiver}: {receiver: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Withdraws exactly `assets` to `receiver`, burning `owner`'s shares.
   * `operator` authorizes; when it is not `owner`, it spends `owner`'s eaSR
   * allowance.
   */
  withdraw: ({assets, receiver, owner, operator}: {assets: i128, receiver: string, owner: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allowance: ({owner, spender}: {owner: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a burn_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  burn_from: ({spender, from, amount}: {spender: string, from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a card_draw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Funds a card purchase (operator): card balance first, then credit from
   * the active lines, earliest escritura first. Sends `amount` to the card
   * settlement account. `auth_ref` (the card authorization) can be used
   * once.
   */
  card_draw: ({agent, amount, auth_ref}: {agent: string, amount: i128, auth_ref: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<DrawResult>>>

  /**
   * Construct and simulate a open_line transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Opens the credit line of a freshly minted note. Only the note contract
   * can call it (it is the direct invoker during `cpcv_note.mint`). The
   * note comes by value: Soroban forbids re-entering `cpcv_note.get`.
   */
  open_line: ({note}: {note: Note}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a write_off transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * After the grace deadline (operator): removes the agent's carried debt
   * from the book, junior tranche first, then senior, and blocks the agent.
   */
  write_off: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Protocol fees to the treasury: amount ≤ min(fees_accrued, pool_cash).
   */
  claim_fees: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a max_redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `owner`'s shares, capped by what the lendable cash can pay out.
   */
  max_redeem: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a enable_card transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The agent's on-chain consent (passkey) for the operator to draw on
   * their behalf when they use the card.
   */
  enable_card: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a max_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_deposit: ({receiver}: {receiver: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a query_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The underlying asset (tEURC).
   */
  query_asset: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_blocked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Blocks or unblocks new credit for an agent (operator).
   */
  set_blocked: ({agent, blocked}: {agent: string, blocked: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a disable_card transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  disable_card: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a max_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `min(convert_to_assets(balance(owner)), lendable)` (spec §5.5).
   */
  max_withdraw: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a preview_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Assets charged by `mint(shares)`: rounded up.
   */
  preview_mint: ({shares}: {shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a protocol_now transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Ledger time + demo offset (spec §5.7): the single source of truth for
   * time, also used by `cpcv_note`.
   */
  protocol_now: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a total_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `senior_assets` after accrual: accounting-based, so token donations
   * cannot move the share price (spec §5.5).
   */
  total_assets: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a advance_clock transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Demo fast-forward (admin, demo mode only): accrues interest up to now,
   * then moves the protocol clock forward by `secs` (≤ 400 days).
   */
  advance_clock: ({secs}: {secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a agent_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_position: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<AgentPosition>>>

  /**
   * Construct and simulate a junior_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * explorador's first-loss capital (treasury).
   */
  junior_deposit: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a preview_redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Assets paid by `redeem(shares)`: rounded down.
   */
  preview_redeem: ({shares}: {shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a junior_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Treasury withdrawal from the junior tranche: amount ≤ junior assets,
   * ≤ lendable, and the leverage cap must still hold afterwards.
   */
  junior_withdraw: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a preview_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Shares minted by `deposit(assets)`: rounded down.
   */
  preview_deposit: ({assets}: {assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a preview_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Shares burned by `withdraw(assets)`: rounded up.
   */
  preview_withdraw: ({assets}: {assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a withdraw_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The agent withdraws card balance to any address (passkey).
   */
  withdraw_balance: ({agent, amount, to}: {agent: string, amount: i128, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a convert_to_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `shares × (total_assets + 1) / (supply + 1)`, rounded down.
   */
  convert_to_assets: ({shares}: {shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a convert_to_shares transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `assets × (supply + 1) / (total_assets + 1)`, rounded down.
   */
  convert_to_shares: ({assets}: {assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, operator, treasury, card_settlement, asset, note_contract, params}: {admin: string, operator: string, treasury: string, card_settlement: string, asset: string, note_contract: string, params: Params},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, operator, treasury, card_settlement, asset, note_contract, params}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAEYnVybgAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAEbGluZQAAAAEAAAAAAAAAB25vdGVfaWQAAAAABAAAAAEAAAPpAAAH0AAAAAhMaW5lVmlldwAAAAM=",
        "AAAAAAAAAEdNaW50cyBleGFjdGx5IGBzaGFyZXNgIHRvIGByZWNlaXZlcmAgZm9yIGBwcmV2aWV3X21pbnQoc2hhcmVzKWAgYXNzZXRzLgAAAAAEbWludAAAAAQAAAAAAAAABnNoYXJlcwAAAAAACwAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAEbmFtZQAAAAAAAAABAAAAEA==",
        "AAAAAAAAAAAAAAAFc3RhdHMAAAAAAAAAAAAAAQAAA+kAAAfQAAAACVBvb2xTdGF0cwAAAAAAAAM=",
        "AAAAAAAAACBCb29rcyBhY2NydWVkIGludGVyZXN0IChhbnlvbmUpLgAAAAZhY2NydWUAAAAAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAALdUaGUgYnV5ZXIgd2Fsa2VkIGF3YXkgKG9wZXJhdG9yKTogdGhlIGxpbmUgZGVidCBtb3ZlcyB0byB0aGUgYWdlbnQncwpjYXJyaWVkIGRlYnQsIHRoZSBjYXJkIGJhbGFuY2UgcmVwYXlzIGl0IGFzIGZhciBhcyBwb3NzaWJsZSwgYW5kIHRoZQpncmFjZSBwZXJpb2Qgc3RhcnRzIChpZiBub3QgYWxyZWFkeSBydW5uaW5nKS4AAAAABmNhbmNlbAAAAAAAAQAAAAAAAAAHbm90ZV9pZAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAGcGFyYW1zAAAAAAAAAAAAAQAAB9AAAAAGUGFyYW1zAAA=",
        "AAAAAAAAAFJCdXJucyBleGFjdGx5IGBzaGFyZXNgIG9mIGBvd25lcmAgYW5kIHBheXMgYHByZXZpZXdfcmVkZWVtKHNoYXJlcylgIHRvCmByZWNlaXZlcmAuAAAAAAAGcmVkZWVtAAAAAAAEAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAhvcGVyYXRvcgAAABMAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAASdFc2NyaXR1cmEgKG9wZXJhdG9yICsgdHJlYXN1cnkpOiBwdWxscyB0aGUgdG90YWwgY29tbWlzc2lvbiBmcm9tIHRoZQp0cmVhc3VyeSwgcmVwYXlzIHRoZSBsaW5lLCB0aGVuIGNhcnJpZWQgZGVidCwgY3JlZGl0cyB0aGUgcmVzdCBvZiB0aGUKYWdlbnQncyBoYWxmIHRvIHRoZSBjYXJkIGJhbGFuY2UgYW5kIGV4cGxvcmFkb3IncyBoYWxmIHRvIHRoZSBqdW5pb3IKdHJhbmNoZS4gSWYgdGhlIGxpbmUgZGVidCBleGNlZWRzIHRoZSBhZ2VudCdzIGhhbGYsIHRoZSBzaG9ydGZhbGwKYmVjb21lcyBjYXJyaWVkIGRlYnQuAAAAAAZzZXR0bGUAAAAAAAEAAAAAAAAAB25vdGVfaWQAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAHYXBwcm92ZQAAAAAEAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAHYmFsYW5jZQAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAACw==",
        "AAAAAAAAAK9EZXBvc2l0cyBgYXNzZXRzYCBmcm9tIGBmcm9tYCBhbmQgbWludHMgZWFTUiB0byBgcmVjZWl2ZXJgLgpgb3BlcmF0b3JgIGF1dGhvcml6ZXM7IHdoZW4gaXQgaXMgbm90IGBmcm9tYCwgaXQgc3BlbmRzIGBmcm9tYCdzIHRFVVJDCmFsbG93YW5jZSAoU0VQLTU2IC8gT3BlblplcHBlbGluIHNlbWFudGljcykuAAAAAAdkZXBvc2l0AAAAAAQAAAAAAAAABmFzc2V0cwAAAAAACwAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAIZGVjaW1hbHMAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAIbWF4X21pbnQAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABQAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAJZXaXRoZHJhd3MgZXhhY3RseSBgYXNzZXRzYCB0byBgcmVjZWl2ZXJgLCBidXJuaW5nIGBvd25lcmAncyBzaGFyZXMuCmBvcGVyYXRvcmAgYXV0aG9yaXplczsgd2hlbiBpdCBpcyBub3QgYG93bmVyYCwgaXQgc3BlbmRzIGBvd25lcmAncyBlYVNSCmFsbG93YW5jZS4AAAAAAAh3aXRoZHJhdwAAAAQAAAAAAAAABmFzc2V0cwAAAAAACwAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAdzcGVuZGVyAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAJYnVybl9mcm9tAAAAAAAAAwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAANdGdW5kcyBhIGNhcmQgcHVyY2hhc2UgKG9wZXJhdG9yKTogY2FyZCBiYWxhbmNlIGZpcnN0LCB0aGVuIGNyZWRpdCBmcm9tCnRoZSBhY3RpdmUgbGluZXMsIGVhcmxpZXN0IGVzY3JpdHVyYSBmaXJzdC4gU2VuZHMgYGFtb3VudGAgdG8gdGhlIGNhcmQKc2V0dGxlbWVudCBhY2NvdW50LiBgYXV0aF9yZWZgICh0aGUgY2FyZCBhdXRob3JpemF0aW9uKSBjYW4gYmUgdXNlZApvbmNlLgAAAAAJY2FyZF9kcmF3AAAAAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACGF1dGhfcmVmAAAD7gAAACAAAAABAAAD6QAAB9AAAAAKRHJhd1Jlc3VsdAAAAAAAAw==",
        "AAAAAAAAAMxPcGVucyB0aGUgY3JlZGl0IGxpbmUgb2YgYSBmcmVzaGx5IG1pbnRlZCBub3RlLiBPbmx5IHRoZSBub3RlIGNvbnRyYWN0CmNhbiBjYWxsIGl0IChpdCBpcyB0aGUgZGlyZWN0IGludm9rZXIgZHVyaW5nIGBjcGN2X25vdGUubWludGApLiBUaGUKbm90ZSBjb21lcyBieSB2YWx1ZTogU29yb2JhbiBmb3JiaWRzIHJlLWVudGVyaW5nIGBjcGN2X25vdGUuZ2V0YC4AAAAJb3Blbl9saW5lAAAAAAAAAQAAAAAAAAAEbm90ZQAAB9AAAAAETm90ZQAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAI1BZnRlciB0aGUgZ3JhY2UgZGVhZGxpbmUgKG9wZXJhdG9yKTogcmVtb3ZlcyB0aGUgYWdlbnQncyBjYXJyaWVkIGRlYnQKZnJvbSB0aGUgYm9vaywganVuaW9yIHRyYW5jaGUgZmlyc3QsIHRoZW4gc2VuaW9yLCBhbmQgYmxvY2tzIHRoZSBhZ2VudC4AAAAAAAAJd3JpdGVfb2ZmAAAAAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEdQcm90b2NvbCBmZWVzIHRvIHRoZSB0cmVhc3VyeTogYW1vdW50IOKJpCBtaW4oZmVlc19hY2NydWVkLCBwb29sX2Nhc2gpLgAAAAAKY2xhaW1fZmVlcwAAAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAD9gb3duZXJgJ3Mgc2hhcmVzLCBjYXBwZWQgYnkgd2hhdCB0aGUgbGVuZGFibGUgY2FzaCBjYW4gcGF5IG91dC4AAAAACm1heF9yZWRlZW0AAAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAGdUaGUgYWdlbnQncyBvbi1jaGFpbiBjb25zZW50IChwYXNza2V5KSBmb3IgdGhlIG9wZXJhdG9yIHRvIGRyYXcgb24KdGhlaXIgYmVoYWxmIHdoZW4gdGhleSB1c2UgdGhlIGNhcmQuAAAAAAtlbmFibGVfY2FyZAAAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAALbWF4X2RlcG9zaXQAAAAAAQAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAB1UaGUgdW5kZXJseWluZyBhc3NldCAodEVVUkMpLgAAAAAAAAtxdWVyeV9hc3NldAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAADZCbG9ja3Mgb3IgdW5ibG9ja3MgbmV3IGNyZWRpdCBmb3IgYW4gYWdlbnQgKG9wZXJhdG9yKS4AAAAAAAtzZXRfYmxvY2tlZAAAAAACAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAAB2Jsb2NrZWQAAAAAAQAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMZGlzYWJsZV9jYXJkAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEBgbWluKGNvbnZlcnRfdG9fYXNzZXRzKGJhbGFuY2Uob3duZXIpKSwgbGVuZGFibGUpYCAoc3BlYyDCpzUuNSkuAAAADG1heF93aXRoZHJhdwAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAC1Bc3NldHMgY2hhcmdlZCBieSBgbWludChzaGFyZXMpYDogcm91bmRlZCB1cC4AAAAAAAAMcHJldmlld19taW50AAAAAQAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAGZMZWRnZXIgdGltZSArIGRlbW8gb2Zmc2V0IChzcGVjIMKnNS43KTogdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yCnRpbWUsIGFsc28gdXNlZCBieSBgY3Bjdl9ub3RlYC4AAAAAAAxwcm90b2NvbF9ub3cAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAG1gc2VuaW9yX2Fzc2V0c2AgYWZ0ZXIgYWNjcnVhbDogYWNjb3VudGluZy1iYXNlZCwgc28gdG9rZW4gZG9uYXRpb25zCmNhbm5vdCBtb3ZlIHRoZSBzaGFyZSBwcmljZSAoc3BlYyDCpzUuNSkuAAAAAAAADHRvdGFsX2Fzc2V0cwAAAAAAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAMdG90YWxfc3VwcGx5AAAAAAAAAAEAAAAL",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAcAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAAAAAAAD2NhcmRfc2V0dGxlbWVudAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAADW5vdGVfY29udHJhY3QAAAAAAAATAAAAAAAAAAZwYXJhbXMAAAAAB9AAAAAGUGFyYW1zAAAAAAAA",
        "AAAAAAAAAIZEZW1vIGZhc3QtZm9yd2FyZCAoYWRtaW4sIGRlbW8gbW9kZSBvbmx5KTogYWNjcnVlcyBpbnRlcmVzdCB1cCB0byBub3csCnRoZW4gbW92ZXMgdGhlIHByb3RvY29sIGNsb2NrIGZvcndhcmQgYnkgYHNlY3NgICjiiaQgNDAwIGRheXMpLgAAAAAADWFkdmFuY2VfY2xvY2sAAAAAAAABAAAAAAAAAARzZWNzAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAOYWdlbnRfcG9zaXRpb24AAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAEAAAPpAAAH0AAAAA1BZ2VudFBvc2l0aW9uAAAAAAAAAw==",
        "AAAAAAAAACtleHBsb3JhZG9yJ3MgZmlyc3QtbG9zcyBjYXBpdGFsICh0cmVhc3VyeSkuAAAAAA5qdW5pb3JfZGVwb3NpdAAAAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAC5Bc3NldHMgcGFpZCBieSBgcmVkZWVtKHNoYXJlcylgOiByb3VuZGVkIGRvd24uAAAAAAAOcHJldmlld19yZWRlZW0AAAAAAAEAAAAAAAAABnNoYXJlcwAAAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAIVUcmVhc3VyeSB3aXRoZHJhd2FsIGZyb20gdGhlIGp1bmlvciB0cmFuY2hlOiBhbW91bnQg4omkIGp1bmlvciBhc3NldHMsCuKJpCBsZW5kYWJsZSwgYW5kIHRoZSBsZXZlcmFnZSBjYXAgbXVzdCBzdGlsbCBob2xkIGFmdGVyd2FyZHMuAAAAAAAAD2p1bmlvcl93aXRoZHJhdwAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAADFTaGFyZXMgbWludGVkIGJ5IGBkZXBvc2l0KGFzc2V0cylgOiByb3VuZGVkIGRvd24uAAAAAAAAD3ByZXZpZXdfZGVwb3NpdAAAAAABAAAAAAAAAAZhc3NldHMAAAAAAAsAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAADBTaGFyZXMgYnVybmVkIGJ5IGB3aXRoZHJhdyhhc3NldHMpYDogcm91bmRlZCB1cC4AAAAQcHJldmlld193aXRoZHJhdwAAAAEAAAAAAAAABmFzc2V0cwAAAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAADpUaGUgYWdlbnQgd2l0aGRyYXdzIGNhcmQgYmFsYW5jZSB0byBhbnkgYWRkcmVzcyAocGFzc2tleSkuAAAAAAAQd2l0aGRyYXdfYmFsYW5jZQAAAAMAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADxgc2hhcmVzIMOXICh0b3RhbF9hc3NldHMgKyAxKSAvIChzdXBwbHkgKyAxKWAsIHJvdW5kZWQgZG93bi4AAAARY29udmVydF90b19hc3NldHMAAAAAAAABAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAADxgYXNzZXRzIMOXIChzdXBwbHkgKyAxKSAvICh0b3RhbF9hc3NldHMgKyAxKWAsIHJvdW5kZWQgZG93bi4AAAARY29udmVydF90b19zaGFyZXMAAAAAAAABAAAAAAAAAAZhc3NldHMAAAAAAAsAAAABAAAD6QAAAAsAAAAD",
        "AAAAAQAAACRDcmVkaXQgbGluZSBiYWNrZWQgYnkgb25lIENQQ1YgTm90ZS4AAAAAAAAABExpbmUAAAAHAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAxYWdlbnRfY29tbWlzc2lvbiDDlyBsdHZfYnBzIC8gQlBTIChyb3VuZGVkIGRvd24pLgAAAAAAAAxjcmVkaXRfbGltaXQAAAALAAAAPURheXMgc2luY2UgdGhlIFVuaXggZXBvY2g7IGVhcmxpZXN0IGVzY3JpdHVyYSBpcyBkcmF3biBmaXJzdC4AAAAAAAANZXNjcml0dXJhX2RheQAAAAAAAAQAAAAAAAAAB25vdGVfaWQAAAAABAAAACBBbW91bnQgZHJhd24gYW5kIG5vdCB5ZXQgcmVwYWlkLgAAAAlwcmluY2lwYWwAAAAAAAALAAAATURlYnQgaW4gYm9ycm93LWluZGV4IHVuaXRzOiBkZWJ0ID0gY2VpbChzY2FsZWRfZGVidCDDlyBib3Jyb3dfaW5kZXggLyBTQ0FMRSkuAAAAAAAAC3NjYWxlZF9kZWJ0AAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApMaW5lU3RhdHVzAAA=",
        "AAAAAQAAADJQcm90b2NvbCBwYXJhbWV0ZXJzLCBmaXhlZCBhdCBkZXBsb3kgKHNwZWMgwqc1LjEpLgAAAAAAAAAAAAZQYXJhbXMAAAAAAAcAAAApQWdlbnQgQVBSIG9uIGRyYXduIGJhbGFuY2VzICgxMjAwID0gMTIlKS4AAAAAAAANYWdlbnRfYXByX2JwcwAAAAAAAAQAAAAlRW5hYmxlcyBgYWR2YW5jZV9jbG9ja2AgKHNwZWMgwqc1LjcpLgAAAAAAAAlkZW1vX21vZGUAAAAAAAABAAAANEdyYWNlIHBlcmlvZCBiZWZvcmUgY2FycmllZCBkZWJ0IGNhbiBiZSB3cml0dGVuIG9mZi4AAAARZ3JhY2VfcGVyaW9kX3NlY3MAAAAAAAAGAAAAPUNyZWRpdCBsaW1pdCBhcyBhIHNoYXJlIG9mIHRoZSBhZ2VudCBjb21taXNzaW9uICg1MDAwID0gNTAlKS4AAAAAAAAHbHR2X2JwcwAAAAAEAAAALVRvdGFsIGRlYnQg4omkIG1heF9sZXZlcmFnZSDDlyBqdW5pb3IgYXNzZXRzLgAAAAAAAAxtYXhfbGV2ZXJhZ2UAAAAEAAAAN1NoYXJlIG9mIGludGVyZXN0IHRoYXQgZ29lcyB0byBleHBsb3JhZG9yICgxMDAwID0gMTAlKS4AAAAAEHByb3RvY29sX2ZlZV9icHMAAAAEAAAAJVNlbmlvciB0cmFuY2hlIEFQWSB0YXJnZXQgKDgwMCA9IDglKS4AAAAAAAARc2VuaW9yX3RhcmdldF9icHMAAAAAAAAE",
        "AAAAAQAAAAAAAAAAAAAACExpbmVWaWV3AAAABAAAADxtYXgoMCwgY3JlZGl0X2xpbWl0IOKIkiBkZWJ0KSBmb3IgYWN0aXZlIGxpbmVzLCAwIG90aGVyd2lzZS4AAAAJYXZhaWxhYmxlAAAAAAAACwAAABpDdXJyZW50IGRlYnQgKHJvdW5kZWQgdXApLgAAAAAABGRlYnQAAAALAAAAE2RlYnQg4oiSIHByaW5jaXBhbC4AAAAACGludGVyZXN0AAAACwAAAAAAAAAEbGluZQAAB9AAAAAETGluZQ==",
        "AAAAAQAAAAAAAAAAAAAACVBvb2xTdGF0cwAAAAAAABEAAAAAAAAADGJvcnJvd19pbmRleAAAAAsAAAAAAAAADGZlZXNfYWNjcnVlZAAAAAsAAAAAAAAADWp1bmlvcl9hc3NldHMAAAAAAAALAAAAAAAAAAhsZW5kYWJsZQAAAAsAAAAAAAAAEWxldmVyYWdlX2hlYWRyb29tAAAAAAAACwAAACJ0b3RhbF9kZWJ0IC8ganVuaW9yX2Fzc2V0cyDDlyAxMDAuAAAAAAANbGV2ZXJhZ2VfeDEwMAAAAAAAAAQAAAAAAAAABnBhcmFtcwAAAAAH0AAAAAZQYXJhbXMAAAAAACxhc3NldC5iYWxhbmNlKHBvb2wpIOKIkiB0b3RhbF9jYXJkX2JhbGFuY2VzLgAAAAlwb29sX2Nhc2gAAAAAAAALAAAAAAAAAAxwcm90b2NvbF9ub3cAAAAGAAAAAAAAAA1zZW5pb3JfYXNzZXRzAAAAAAAACwAAAElBc3NldHMgcGVyIDEgc2hhcmUgw5cgU0NBTEU6IChzZW5pb3JfYXNzZXRzICsgMSkgw5cgU0NBTEUgLyAoc3VwcGx5ICsgMSkuAAAAAAAAEnNoYXJlX3ByaWNlX3NjYWxlZAAAAAAACwAAAAAAAAAMc2hhcmVfc3VwcGx5AAAACwAAAAAAAAATdG90YWxfY2FyZF9iYWxhbmNlcwAAAAALAAAAAAAAAAp0b3RhbF9kZWJ0AAAAAAALAAAAAAAAAA90b3RhbF9wcmluY2lwYWwAAAAACwAAAC10b3RhbF9kZWJ0IC8gKHRvdGFsX2RlYnQgKyBsZW5kYWJsZSksIGluIGJwcy4AAAAAAAAPdXRpbGl6YXRpb25fYnBzAAAAAAQAAAAAAAAAEXdyaXR0ZW5fb2ZmX3RvdGFsAAAAAAAACw==",
        "AAAAAQAAAAAAAAAAAAAACkRyYXdSZXN1bHQAAAAAAAIAAAAAAAAADGZyb21fYmFsYW5jZQAAAAsAAAAAAAAAC2Zyb21fY3JlZGl0AAAAAAs=",
        "AAAAAgAAAAAAAAAAAAAACkxpbmVTdGF0dXMAAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAAAAAAAAAAAAADUFnZW50UG9zaXRpb24AAAAAAAAKAAAAOWJsb2NrZWQgPyAwIDogbWF4KDAsIM6jIGxpbmUgYXZhaWxhYmxlIOKIkiBjYXJyaWVkIGRlYnQpLgAAAAAAABBhdmFpbGFibGVfY3JlZGl0AAAACwAAAAAAAAAHYmxvY2tlZAAAAAABAAAAM21pbihhdmFpbGFibGVfY3JlZGl0LCBsZW5kYWJsZSwgbGV2ZXJhZ2VfaGVhZHJvb20pLgAAAAAOYm9ycm93YWJsZV9ub3cAAAAAAAsAAAAAAAAADGNhcmRfYmFsYW5jZQAAAAsAAAAAAAAADGNhcmRfZW5hYmxlZAAAAAEAAAAAAAAADGNhcnJpZWRfZGVidAAAAAsAAAAAAAAADmdyYWNlX2RlYWRsaW5lAAAAAAPoAAAABgAAABtBY3RpdmUgbGluZXMgaW4gZHJhdyBvcmRlci4AAAAABWxpbmVzAAAAAAAD6gAAB9AAAAAITGluZVZpZXcAAAAkRGVidCBvbiBhY3RpdmUgbGluZXMgKyBjYXJyaWVkIGRlYnQuAAAACnRvdGFsX2RlYnQAAAAAAAsAAAAAAAAAD3RvdGFsX3ByaW5jaXBhbAAAAAAL",
        "AAAABQAAAAAAAAAAAAAACENhcmREcmF3AAAAAQAAAAljYXJkX2RyYXcAAAAAAAAFAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAxmcm9tX2JhbGFuY2UAAAALAAAAAAAAAAAAAAALZnJvbV9jcmVkaXQAAAAACwAAAAAAAAAAAAAACGF1dGhfcmVmAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAACkxpbmVPcGVuZWQAAAAAAAEAAAALbGluZV9vcGVuZWQAAAAAAwAAAAAAAAAHbm90ZV9pZAAAAAAEAAAAAAAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAAAAAAMY3JlZGl0X2xpbWl0AAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAC0NhcmRFbmFibGVkAAAAAAEAAAAMY2FyZF9lbmFibGVkAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC0ZlZXNDbGFpbWVkAAAAAAEAAAAMZmVlc19jbGFpbWVkAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC05vdGVTZXR0bGVkAAAAAAEAAAAMbm90ZV9zZXR0bGVkAAAACAAAAAAAAAAHbm90ZV9pZAAAAAAEAAAAAAAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAAAAAAQdG90YWxfY29tbWlzc2lvbgAAAAsAAAAAAAAAPkxpbmUgZGVidCByZXBhaWQgZnJvbSB0aGUgYWdlbnQncyBoYWxmIChwcmluY2lwYWwgKyBpbnRlcmVzdCkuAAAAAAALZGVidF9yZXBhaWQAAAAACwAAAAAAAAAfSW50ZXJlc3QgcGFydCBvZiBgZGVidF9yZXBhaWRgLgAAAAANaW50ZXJlc3RfcGFpZAAAAAAAAAsAAAAAAAAAO0NhcnJpZWQgZGVidCByZXBhaWQgZnJvbSB3aGF0IHdhcyBsZWZ0IG9mIHRoZSBhZ2VudCdzIGhhbGYuAAAAAA5jYXJyaWVkX3JlcGFpZAAAAAAACwAAAAAAAAAlQ3JlZGl0ZWQgdG8gdGhlIGFnZW50J3MgY2FyZCBiYWxhbmNlLgAAAAAAAAxhZ2VudF9wYXlvdXQAAAALAAAAAAAAAC9leHBsb3JhZG9yJ3MgaGFsZiwgYWRkZWQgdG8gdGhlIGp1bmlvciB0cmFuY2hlLgAAAAAOanVuaW9yX2RlcG9zaXQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADUNsb2NrQWR2YW5jZWQAAAAAAAABAAAADmNsb2NrX2FkdmFuY2VkAAAAAAACAAAAAAAAAARzZWNzAAAABgAAAAAAAAAAAAAADHByb3RvY29sX25vdwAAAAYAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADUp1bmlvckRlcG9zaXQAAAAAAAABAAAADmp1bmlvcl9kZXBvc2l0AAAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADU5vdGVDYW5jZWxsZWQAAAAAAAABAAAADm5vdGVfY2FuY2VsbGVkAAAAAAAEAAAAAAAAAAdub3RlX2lkAAAAAAQAAAAAAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAAW0xpbmUgZGVidCBtb3ZlZCBpbnRvIHRoZSBhZ2VudCdzIGNhcnJpZWQgZGVidCAoYmVmb3JlIGFueSByZXBheW1lbnQKZnJvbSB0aGUgY2FyZCBiYWxhbmNlKS4AAAAADGRlYnRfY2FycmllZAAAAAsAAAAAAAAAAAAAAA5ncmFjZV9kZWFkbGluZQAAAAAD6AAAAAYAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADkRlYnRXcml0dGVuT2ZmAAAAAAABAAAAEGRlYnRfd3JpdHRlbl9vZmYAAAAEAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAAI0NhcnJpZWQgZGVidCByZW1vdmVkIGZyb20gdGhlIGJvb2suAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAtqdW5pb3JfbG9zcwAAAAALAAAAAAAAAAAAAAALc2VuaW9yX2xvc3MAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADkp1bmlvcldpdGhkcmF3AAAAAAABAAAAD2p1bmlvcl93aXRoZHJhdwAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEEJhbGFuY2VXaXRoZHJhd24AAAABAAAAEWJhbGFuY2Vfd2l0aGRyYXduAAAAAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAACdG8AAAAAABMAAAAAAAAAAg==",
        "AAAAAQAAADhBIHNvdWxib3VuZCBDUENWIE5vdGUgKHNwZWMgwqc3LjIpLiBBbW91bnRzIGFyZSBzdHJvb3BzLgAAAAAAAAAETm90ZQAAAAsAAAAAAAAABWFnZW50AAAAAAAAEwAAABtmbG9vcih0b3RhbF9jb21taXNzaW9uIC8gMikAAAAAEGFnZW50X2NvbW1pc3Npb24AAAALAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAABpEYXlzIHNpbmNlIHRoZSBVbml4IGVwb2NoLgAAAAAADWVzY3JpdHVyYV9kYXkAAAAAAAAEAAAAJXRvdGFsX2NvbW1pc3Npb24g4oiSIGFnZW50X2NvbW1pc3Npb24AAAAAAAAVZXhwbG9yYWRvcl9jb21taXNzaW9uAAAAAAAACwAAAAAAAAACaWQAAAAAAAQAAAAeUHJvdG9jb2wgY2xvY2sgKHVuaXggc2Vjb25kcykuAAAAAAAJbWludGVkX2F0AAAAAAAABgAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAABXByb29mAAAAAAAH0AAAAAxHcm90aDE2UHJvb2YAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApOb3RlU3RhdHVzAAAAAAAAAAAAEHRvdGFsX2NvbW1pc3Npb24AAAAL",
        "AAAAAgAAAAAAAAAAAAAACk5vdGVTdGF0dXMAAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAAJhHcm90aDE2IHByb29mIG92ZXIgQk4yNTQuIGBhYCBpcyBzdG9yZWQgTkVHQVRFRCAo4oiSQSkgc28gdmVyaWZpY2F0aW9uIGlzIGEKc2luZ2xlIHByb2R1Y3Qtb2YtcGFpcmluZ3MgPT0gMSBjaGVjayAoc3BlYyDCpzguNSkuIEcxID0gNjQgYnl0ZXMsIEcyID0gMTI4LgAAAAAAAAAMR3JvdGgxNlByb29mAAAAAwAAAAAAAAABYQAAAAAAA+4AAABAAAAAAAAAAAFiAAAAAAAD7gAAAIAAAAAAAAAAAWMAAAAAAAPuAAAAQA==",
        "AAAABAAAAIdTaGFyZWQgZXJyb3IgbnVtYmVyaW5nIGZvciBhbGwgZXhwbG9yYWRvciBhZHZhbmNlIGNvbnRyYWN0cyAoc3BlYyDCpzcuMykuCkFwcGVuZCBuZXcgdmFyaWFudHMgYXQgdGhlIGVuZDsgbmV2ZXIgcmVudW1iZXIgZXhpc3Rpbmcgb25lcy4AAAAAAAAAAAVFcnJvcgAAAAAAABYAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAABAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAABJJbnN1ZmZpY2llbnRDcmVkaXQAAAAAAAQAAAAAAAAAFUluc3VmZmljaWVudExpcXVpZGl0eQAAAAAAAAUAAAAAAAAAE0xldmVyYWdlQ2FwRXhjZWVkZWQAAAAABgAAAAAAAAAOQ2FyZE5vdEVuYWJsZWQAAAAAAAcAAAAAAAAADEFnZW50QmxvY2tlZAAAAAgAAAAAAAAADUxpbmVOb3RBY3RpdmUAAAAAAAAJAAAAAAAAAAxHcmFjZU5vdE92ZXIAAAAKAAAAAAAAABFOb3RoaW5nVG9Xcml0ZU9mZgAAAAAAAAsAAAAAAAAADUR1cGxpY2F0ZURyYXcAAAAAAAAMAAAAAAAAAAxJbnZhbGlkUHJvb2YAAAANAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAADgAAAAAAAAAOQ29tbWl0bWVudFVzZWQAAAAAAA8AAAAAAAAAD0VzY3JpdHVyYUluUGFzdAAAAAAQAAAAAAAAAAlTb3VsYm91bmQAAAAAAAARAAAAAAAAAAtVbmtub3duTm90ZQAAAAASAAAAOWBhZHZhbmNlX2Nsb2NrYCBjYWxsZWQgd2hpbGUgYHBhcmFtcy5kZW1vX21vZGVgIGlzIGZhbHNlLgAAAAAAABBEZW1vTW9kZURpc2FibGVkAAAAEwAAAC9gYWR2YW5jZV9jbG9ja2AgYWJvdmUgdGhlIDQwMC1kYXkgcGVyLWNhbGwgY2FwLgAAAAAUQ2xvY2tBZHZhbmNlVG9vTGFyZ2UAAAAUAAAAHkNoZWNrZWQgYXJpdGhtZXRpYyBvdmVyZmxvd2VkLgAAAAAACE92ZXJmbG93AAAAFQAAACRgY3Bjdl9ub3RlLnNldF9wb29sYCBub3QgY2FsbGVkIHlldC4AAAAKUG9vbE5vdFNldAAAAAAAFg==",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gdG9rZW5zIGFyZSBidXJuZWQuAAAAAAAAAAAAAARCdXJuAAAAAQAAAARidXJuAAAAAgAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAEJFdmVudCBlbWl0dGVkIHdoZW4gdW5kZXJseWluZyBhc3NldHMgYXJlIGRlcG9zaXRlZCBpbnRvIHRoZSB2YXVsdC4AAAAAAAAAAAAHRGVwb3NpdAAAAAABAAAAB2RlcG9zaXQAAAAABQAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAAAAAAAAZhc3NldHMAAAAAAAsAAAAAAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAENFdmVudCBlbWl0dGVkIHdoZW4gc2hhcmVzIGFyZSBleGNoYW5nZWQgYmFjayBmb3IgdW5kZXJseWluZyBhc3NldHMuAAAAAAAAAAAIV2l0aGRyYXcAAAABAAAACHdpdGhkcmF3AAAABQAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAAAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAAAAAAI=",
        "AAAABQAAACxFdmVudCBlbWl0dGVkIHdoZW4gYW4gYWxsb3dhbmNlIGlzIGFwcHJvdmVkLgAAAAAAAAAHQXBwcm92ZQAAAAABAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAASFFdmVudCBlbWl0dGVkIHdoZW4gdG9rZW5zIGFyZSB0cmFuc2ZlcnJlZCBiZXR3ZWVuIGFkZHJlc3NlcyB3aXRob3V0IGEKbXV4ZWQgZGVzdGluYXRpb24uCgpQZXIgU0VQLTQxLCB0aGUgZXZlbnQgZGF0YSBpcyBhIGJhcmUgYGkxMjhgIHdoZW4gbm8gbXV4ZWQgYWRkcmVzcyBpcwppbnZvbHZlZC4gVGhlIGBkYXRhX2Zvcm1hdCA9ICJzaW5nbGUtdmFsdWUiYCBhdHRyaWJ1dGUgZW5zdXJlcyB0aGUKYGFtb3VudGAgZmllbGQgaXMgc2VyaWFsaXplZCBhcyBhIGJhcmUgdmFsdWUgcmF0aGVyIHRoYW4gYSBtYXAuAAAAAAAAAAAAAAhUcmFuc2ZlcgAAAAEAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAA=",
        "AAAABQAAAZdFdmVudCBlbWl0dGVkIHdoZW4gdG9rZW5zIGFyZSB0cmFuc2ZlcnJlZCB0byBhIG11eGVkIGFkZHJlc3MuCgpQZXIgU0VQLTQxLCB3aGVuIHRoZSBkZXN0aW5hdGlvbiBpcyBhIFtgTXV4ZWRBZGRyZXNzYF0gdGhlIGV2ZW50IGRhdGEKY2FycmllcyBib3RoIHRoZSBhbW91bnQgYW5kIHRoZSBtdXhlZCBpZGVudGlmaWVyIHNvIHRoYXQgb2ZmLWNoYWluCmNvbnN1bWVycyBjYW4gYXR0cmlidXRlIHRoZSB0cmFuc2ZlciB0byB0aGUgY29ycmVjdCBzdWItYWNjb3VudC4KClVzZXMgYHRvcGljcyA9IFsidHJhbnNmZXIiXWAgc28gdGhhdCBib3RoIFtgVHJhbnNmZXJgXSBhbmQKW2BNdXhlZFRyYW5zZmVyYF0gc2hhcmUgdGhlIHNhbWUgYCJ0cmFuc2ZlciJgIGV2ZW50IHN5bWJvbCwgYXMgcmVxdWlyZWQKYnkgU0VQLTQxLgAAAAAAAAAADU11eGVkVHJhbnNmZXIAAAAAAAABAAAACHRyYW5zZmVyAAAABAAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAAC3RvX211eGVkX2lkAAAAA+gAAAAGAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABAAAAAAAAAAAAAAAEkZ1bmdpYmxlVG9rZW5FcnJvcgAAAAAADwAAAG5JbmRpY2F0ZXMgYW4gZXJyb3IgcmVsYXRlZCB0byB0aGUgY3VycmVudCBiYWxhbmNlIG9mIGFjY291bnQgZnJvbSB3aGljaAp0b2tlbnMgYXJlIGV4cGVjdGVkIHRvIGJlIHRyYW5zZmVycmVkLgAAAAAAE0luc3VmZmljaWVudEJhbGFuY2UAAAAAZAAAAGRJbmRpY2F0ZXMgYSBmYWlsdXJlIHdpdGggdGhlIGFsbG93YW5jZSBtZWNoYW5pc20gd2hlbiBhIGdpdmVuIHNwZW5kZXIKZG9lc24ndCBoYXZlIGVub3VnaCBhbGxvd2FuY2UuAAAAFUluc3VmZmljaWVudEFsbG93YW5jZQAAAAAAAGUAAABNSW5kaWNhdGVzIGFuIGludmFsaWQgdmFsdWUgZm9yIGBsaXZlX3VudGlsX2xlZGdlcmAgd2hlbiBzZXR0aW5nIGFuCmFsbG93YW5jZS4AAAAAAAAWSW52YWxpZExpdmVVbnRpbExlZGdlcgAAAAAAZgAAADJJbmRpY2F0ZXMgYW4gZXJyb3Igd2hlbiBhbiBpbnB1dCB0aGF0IG11c3QgYmUgPj0gMAAAAAAADExlc3NUaGFuWmVybwAAAGcAAAA9SW5kaWNhdGVzIGFuIG92ZXJmbG93IG9yIHVuZGVyZmxvdyBpbiBhbiBhcml0aG1ldGljIG9wZXJhdGlvbgAAAAAAAAxNYXRoT3ZlcmZsb3cAAABoAAAAKkluZGljYXRlcyBhY2Nlc3MgdG8gdW5pbml0aWFsaXplZCBtZXRhZGF0YQAAAAAADVVuc2V0TWV0YWRhdGEAAAAAAABpAAAAUkluZGljYXRlcyB0aGF0IHRoZSBvcGVyYXRpb24gd291bGQgaGF2ZSBjYXVzZWQgYHRvdGFsX3N1cHBseWAgdG8gZXhjZWVkCnRoZSBgY2FwYC4AAAAAAAtFeGNlZWRlZENhcAAAAABqAAAANkluZGljYXRlcyB0aGUgc3VwcGxpZWQgYGNhcGAgaXMgbm90IGEgdmFsaWQgY2FwIHZhbHVlLgAAAAAACkludmFsaWRDYXAAAAAAAGsAAAAeSW5kaWNhdGVzIHRoZSBDYXAgd2FzIG5vdCBzZXQuAAAAAAAJQ2FwTm90U2V0AAAAAAAAbAAAACZJbmRpY2F0ZXMgdGhlIFNBQyBhZGRyZXNzIHdhcyBub3Qgc2V0LgAAAAAACVNBQ05vdFNldAAAAAAAAG0AAAAwSW5kaWNhdGVzIGEgU0FDIGFkZHJlc3MgZGlmZmVyZW50IHRoYW4gZXhwZWN0ZWQuAAAAElNBQ0FkZHJlc3NNaXNtYXRjaAAAAAAAbgAAAENJbmRpY2F0ZXMgYSBtaXNzaW5nIGZ1bmN0aW9uIHBhcmFtZXRlciBpbiB0aGUgU0FDIGNvbnRyYWN0IGNvbnRleHQuAAAAABFTQUNNaXNzaW5nRm5QYXJhbQAAAAAAAG8AAABESW5kaWNhdGVzIGFuIGludmFsaWQgZnVuY3Rpb24gcGFyYW1ldGVyIGluIHRoZSBTQUMgY29udHJhY3QgY29udGV4dC4AAAARU0FDSW52YWxpZEZuUGFyYW0AAAAAAABwAAAAMVRoZSB1c2VyIGlzIG5vdCBhbGxvd2VkIHRvIHBlcmZvcm0gdGhpcyBvcGVyYXRpb24AAAAAAAAOVXNlck5vdEFsbG93ZWQAAAAAAHEAAAA1VGhlIHVzZXIgaXMgYmxvY2tlZCBhbmQgY2Fubm90IHBlcmZvcm0gdGhpcyBvcGVyYXRpb24AAAAAAAALVXNlckJsb2NrZWQAAAAAcg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    burn: this.txFromJSON<null>,
        line: this.txFromJSON<Result<LineView>>,
        mint: this.txFromJSON<Result<i128>>,
        name: this.txFromJSON<string>,
        stats: this.txFromJSON<Result<PoolStats>>,
        accrue: this.txFromJSON<Result<void>>,
        cancel: this.txFromJSON<Result<void>>,
        params: this.txFromJSON<Params>,
        redeem: this.txFromJSON<Result<i128>>,
        settle: this.txFromJSON<Result<void>>,
        symbol: this.txFromJSON<string>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<i128>,
        deposit: this.txFromJSON<Result<i128>>,
        decimals: this.txFromJSON<u32>,
        max_mint: this.txFromJSON<i128>,
        transfer: this.txFromJSON<null>,
        withdraw: this.txFromJSON<Result<i128>>,
        allowance: this.txFromJSON<i128>,
        burn_from: this.txFromJSON<null>,
        card_draw: this.txFromJSON<Result<DrawResult>>,
        open_line: this.txFromJSON<Result<void>>,
        write_off: this.txFromJSON<Result<void>>,
        claim_fees: this.txFromJSON<Result<void>>,
        max_redeem: this.txFromJSON<Result<i128>>,
        enable_card: this.txFromJSON<Result<void>>,
        max_deposit: this.txFromJSON<i128>,
        query_asset: this.txFromJSON<string>,
        set_blocked: this.txFromJSON<Result<void>>,
        disable_card: this.txFromJSON<Result<void>>,
        max_withdraw: this.txFromJSON<Result<i128>>,
        preview_mint: this.txFromJSON<Result<i128>>,
        protocol_now: this.txFromJSON<u64>,
        total_assets: this.txFromJSON<Result<i128>>,
        total_supply: this.txFromJSON<i128>,
        advance_clock: this.txFromJSON<Result<void>>,
        transfer_from: this.txFromJSON<null>,
        agent_position: this.txFromJSON<Result<AgentPosition>>,
        junior_deposit: this.txFromJSON<Result<void>>,
        preview_redeem: this.txFromJSON<Result<i128>>,
        junior_withdraw: this.txFromJSON<Result<void>>,
        preview_deposit: this.txFromJSON<Result<i128>>,
        preview_withdraw: this.txFromJSON<Result<i128>>,
        withdraw_balance: this.txFromJSON<Result<void>>,
        convert_to_assets: this.txFromJSON<Result<i128>>,
        convert_to_shares: this.txFromJSON<Result<i128>>
  }
}