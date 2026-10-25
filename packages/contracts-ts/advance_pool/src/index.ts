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


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CB3I2COOIFAVI66MOKPBHPTT6Z3KPVTGVKBOY6VG3T5SQOXRBJCELN5S",
  }
} as const


export interface Line {
  agent: string;
  credit_limit: i128;
  escritura_day: u32;
  note_id: u32;
  principal: i128;
  scaled_debt: i128;
  status: LineStatus;
}


export interface Params {
  agent_apr_bps: u32;
  demo_mode: boolean;
  grace_period_secs: u64;
  ltv_bps: u32;
  max_leverage: u32;
  protocol_fee_bps: u32;
  senior_target_bps: u32;
}


export interface LineView {
  available: i128;
  debt: i128;
  interest: i128;
  line: Line;
}


/**
 * Pool-wide numbers, computed against a non-mutating preview of `accrue()`.
 * 
 * - `share_price_scaled` = (total_assets + 1) × SCALE / (supply + 1): assets per share × 10^18.
 * - `utilization_bps` = total_debt × BPS / (senior_assets + junior_assets), 0 when the denominator is 0.
 * - `leverage_x100` = total_debt × 100 / junior_assets (0 with no debt, u32::MAX-capped).
 */
export interface PoolStats {
  borrow_index: i128;
  fees_accrued: i128;
  junior_assets: i128;
  lendable: i128;
  leverage_headroom: i128;
  leverage_x100: u32;
  params: Params;
  pool_cash: i128;
  protocol_now: u64;
  senior_assets: i128;
  share_price_scaled: i128;
  share_supply: i128;
  total_card_balances: i128;
  total_debt: i128;
  total_principal: i128;
  utilization_bps: u32;
  written_off_total: i128;
}


export interface AgentState {
  active_lines: Array<u32>;
  blocked: boolean;
  card_balance: i128;
  card_enabled: boolean;
  carried_principal: i128;
  carried_scaled: i128;
  grace_deadline: Option<u64>;
  written_off_total: i128;
}


export interface DrawResult {
  from_balance: i128;
  from_credit: i128;
}

export type LineStatus = {tag: "Active", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void};


/**
 * Static wiring of the pool (helper view for the backend).
 */
export interface PoolConfig {
  admin: string;
  asset: string;
  card_settlement: string;
  note_contract: string;
  operator: string;
  treasury: string;
}


export interface AgentPosition {
  available_credit: i128;
  blocked: boolean;
  borrowable_now: i128;
  card_balance: i128;
  card_enabled: boolean;
  carried_debt: i128;
  grace_deadline: Option<u64>;
  lines: Array<LineView>;
  total_debt: i128;
  total_principal: i128;
}













/**
 * Error codes shared by all explorador advance contracts (§7.3).
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
  19: {message:"MathOverflow"},
  20: {message:"DemoModeDisabled"},
  21: {message:"InvalidParams"},
  22: {message:"ClockAdvanceTooLarge"},
  23: {message:"FaucetLimitExceeded"},
  24: {message:"InsufficientBalance"},
  25: {message:"ExceedsMaximum"},
  26: {message:"PoolNotSet"},
  27: {message:"NonCanonicalField"}
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
   * Burning shares is allowed (SEP-41) and keeps the supply counter exact;
   * the burned claim accrues to the remaining holders.
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a line transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  line: ({note_id}: {note_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<LineView>>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mint: ({shares, receiver, from, operator}: {shares: i128, receiver: string, from: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the name for this token.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a stats transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  stats: (options?: MethodOptions) => Promise<AssembledTransaction<PoolStats>>

  /**
   * Construct and simulate a accrue transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Anyone.
   */
  accrue: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Operator: the buyer walked away. The line's debt becomes the agent's carried debt.
   */
  cancel: ({note_id}: {note_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<PoolConfig>>

  /**
   * Construct and simulate a params transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  params: (options?: MethodOptions) => Promise<AssembledTransaction<Params>>

  /**
   * Construct and simulate a redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  redeem: ({shares, receiver, owner, operator}: {shares: i128, receiver: string, owner: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Operator + treasury: the escritura happened; the commission pays the debt.
   */
  settle: ({note_id}: {note_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the symbol for this token.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets the amount of tokens a `spender` is allowed to spend on behalf of
   * an `owner`. Overrides any existing allowance set between `spender` and
   * `owner`.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   * * `owner` - The address holding the tokens.
   * * `spender` - The address authorized to spend the tokens.
   * * `amount` - The amount of tokens made available to `spender`.
   * * `live_until_ledger` - The ledger number at which the allowance
   * expires.
   * 
   * # Errors
   * 
   * * [`FungibleTokenError::InvalidLiveUntilLedger`] - Occurs when
   * attempting to set `live_until_ledger` that is less than the current
   * ledger number and greater than `0`.
   * * [`FungibleTokenError::LessThanZero`] - Occurs when `amount < 0`.
   * 
   * # Events
   * 
   * * topics - `["approve", owner: Address, spender: Address]`
   * * data - `[amount: i128, live_until_ledger: u32]`
   */
  approve: ({owner, spender, amount, live_until_ledger}: {owner: string, spender: string, amount: i128, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the amount of tokens held by `account`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `account` - The address for which the balance is being queried.
   */
  balance: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({assets, receiver, from, operator}: {assets: i128, receiver: string, from: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the number of decimals used to represent amounts of this token.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   */
  decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a max_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_mint: ({receiver}: {receiver: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers `amount` of tokens from `from` to `to`.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   * * `from` - The address holding the tokens.
   * * `to` - The address receiving the transferred tokens.
   * * `amount` - The amount of tokens to be transferred.
   * 
   * # Errors
   * 
   * * [`FungibleTokenError::InsufficientBalance`] - When attempting to
   * transfer more tokens than `from` current balance.
   * * [`FungibleTokenError::LessThanZero`] - When `amount < 0`.
   * 
   * # Events
   * 
   * * topics - `["transfer", from: Address, to: Address]`
   * * data - `amount: i128` (when `to` has no muxed ID)
   * * data - `{to_muxed_id: Option<u64>, amount: i128}` (when `to` has a
   * muxed ID)
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw: ({assets, receiver, owner, operator}: {assets: i128, receiver: string, owner: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the amount of tokens a `spender` is allowed to spend on behalf
   * of an `owner`.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   * * `owner` - The address holding the tokens.
   * * `spender` - The address authorized to spend the tokens.
   */
  allowance: ({owner, spender}: {owner: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a burn_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  burn_from: ({spender, from, amount}: {spender: string, from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a card_draw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Operator: funds a card spend from the card balance first, then credit
   * (earliest escritura first), paying `card_settlement`.
   */
  card_draw: ({agent, amount, auth_ref}: {agent: string, amount: i128, auth_ref: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<DrawResult>>>

  /**
   * Construct and simulate a draw_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  draw_used: ({auth_ref}: {auth_ref: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a open_line transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Note contract only. Soroban forbids re-entrancy, so the note passes its terms.
   */
  open_line: ({note_id, agent, agent_commission, escritura_day}: {note_id: u32, agent: string, agent_commission: i128, escritura_day: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a write_off transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Operator, after the grace deadline: losses hit junior first, then senior.
   */
  write_off: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_fees: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a max_redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_redeem: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a agent_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_state: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<AgentState>>

  /**
   * Construct and simulate a demo_offset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  demo_offset: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a enable_card transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The agent's on-chain consent (passkey) for the operator to draw by card.
   */
  enable_card: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a max_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_deposit: ({receiver}: {receiver: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a query_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  query_asset: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_blocked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_blocked: ({agent, blocked}: {agent: string, blocked: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a disable_card transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  disable_card: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a max_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_withdraw: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a preview_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  preview_mint: ({shares}: {shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a protocol_now transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  protocol_now: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a total_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accounting-based (not balance-based): donations cannot move the share price.
   */
  total_assets: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a advance_clock transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin, demo mode only: accrue, then move the protocol clock forward.
   */
  advance_clock: ({secs}: {secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfers `amount` of tokens from `from` to `to` using the
   * allowance mechanism. `amount` is then deducted from `spender`
   * allowance.
   * 
   * # Arguments
   * 
   * * `e` - Access to Soroban environment.
   * * `spender` - The address authorizing the transfer, and having its
   * allowance consumed during the transfer.
   * * `from` - The address holding the tokens which will be transferred.
   * * `to` - The address receiving the transferred tokens.
   * * `amount` - The amount of tokens to be transferred.
   * 
   * # Errors
   * 
   * * [`FungibleTokenError::InsufficientBalance`] - When attempting to
   * transfer more tokens than `from` current balance.
   * * [`FungibleTokenError::LessThanZero`] - When `amount < 0`.
   * * [`FungibleTokenError::InsufficientAllowance`] - When attempting to
   * transfer more tokens than `spender` current allowance.
   * 
   * # Events
   * 
   * * topics - `["transfer", from: Address, to: Address]`
   * * data - `[amount: i128]`
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a agent_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_position: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<AgentPosition>>

  /**
   * Construct and simulate a junior_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  junior_deposit: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a preview_redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  preview_redeem: ({shares}: {shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a junior_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  junior_withdraw: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a preview_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  preview_deposit: ({assets}: {assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a preview_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  preview_withdraw: ({assets}: {assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a withdraw_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Agent (passkey): moves card balance out of the pool.
   */
  withdraw_balance: ({agent, amount, to}: {agent: string, amount: i128, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a convert_to_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  convert_to_assets: ({shares}: {shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a convert_to_shares transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  convert_to_shares: ({assets}: {assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

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
      new ContractSpec([ "AAAAAAAAAHlCdXJuaW5nIHNoYXJlcyBpcyBhbGxvd2VkIChTRVAtNDEpIGFuZCBrZWVwcyB0aGUgc3VwcGx5IGNvdW50ZXIgZXhhY3Q7CnRoZSBidXJuZWQgY2xhaW0gYWNjcnVlcyB0byB0aGUgcmVtYWluaW5nIGhvbGRlcnMuAAAAAAAABGJ1cm4AAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAAAAAAAEbGluZQAAAAEAAAAAAAAAB25vdGVfaWQAAAAABAAAAAEAAAPpAAAH0AAAAAhMaW5lVmlldwAAAAM=",
        "AAAAAAAAAAAAAAAEbWludAAAAAQAAAAAAAAABnNoYXJlcwAAAAAACwAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAFVSZXR1cm5zIHRoZSBuYW1lIGZvciB0aGlzIHRva2VuLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAAAABG5hbWUAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAFc3RhdHMAAAAAAAAAAAAAAQAAB9AAAAAJUG9vbFN0YXRzAAAA",
        "AAAAAAAAAAdBbnlvbmUuAAAAAAZhY2NydWUAAAAAAAAAAAAA",
        "AAAAAAAAAFJPcGVyYXRvcjogdGhlIGJ1eWVyIHdhbGtlZCBhd2F5LiBUaGUgbGluZSdzIGRlYnQgYmVjb21lcyB0aGUgYWdlbnQncyBjYXJyaWVkIGRlYnQuAAAAAAAGY2FuY2VsAAAAAAABAAAAAAAAAAdub3RlX2lkAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAKUG9vbENvbmZpZwAA",
        "AAAAAAAAAAAAAAAGcGFyYW1zAAAAAAAAAAAAAQAAB9AAAAAGUGFyYW1zAAA=",
        "AAAAAAAAAAAAAAAGcmVkZWVtAAAAAAAEAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAhvcGVyYXRvcgAAABMAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAEpPcGVyYXRvciArIHRyZWFzdXJ5OiB0aGUgZXNjcml0dXJhIGhhcHBlbmVkOyB0aGUgY29tbWlzc2lvbiBwYXlzIHRoZSBkZWJ0LgAAAAAABnNldHRsZQAAAAAAAQAAAAAAAAAHbm90ZV9pZAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAFdSZXR1cm5zIHRoZSBzeW1ib2wgZm9yIHRoaXMgdG9rZW4uCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4AAAAABnN5bWJvbAAAAAAAAAAAAAEAAAAQ",
        "AAAAAAAAAydTZXRzIHRoZSBhbW91bnQgb2YgdG9rZW5zIGEgYHNwZW5kZXJgIGlzIGFsbG93ZWQgdG8gc3BlbmQgb24gYmVoYWxmIG9mCmFuIGBvd25lcmAuIE92ZXJyaWRlcyBhbnkgZXhpc3RpbmcgYWxsb3dhbmNlIHNldCBiZXR3ZWVuIGBzcGVuZGVyYCBhbmQKYG93bmVyYC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBvd25lcmAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSB0b2tlbnMuCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3MgYXV0aG9yaXplZCB0byBzcGVuZCB0aGUgdG9rZW5zLgoqIGBhbW91bnRgIC0gVGhlIGFtb3VudCBvZiB0b2tlbnMgbWFkZSBhdmFpbGFibGUgdG8gYHNwZW5kZXJgLgoqIGBsaXZlX3VudGlsX2xlZGdlcmAgLSBUaGUgbGVkZ2VyIG51bWJlciBhdCB3aGljaCB0aGUgYWxsb3dhbmNlCmV4cGlyZXMuCgojIEVycm9ycwoKKiBbYEZ1bmdpYmxlVG9rZW5FcnJvcjo6SW52YWxpZExpdmVVbnRpbExlZGdlcmBdIC0gT2NjdXJzIHdoZW4KYXR0ZW1wdGluZyB0byBzZXQgYGxpdmVfdW50aWxfbGVkZ2VyYCB0aGF0IGlzIGxlc3MgdGhhbiB0aGUgY3VycmVudApsZWRnZXIgbnVtYmVyIGFuZCBncmVhdGVyIHRoYW4gYDBgLgoqIFtgRnVuZ2libGVUb2tlbkVycm9yOjpMZXNzVGhhblplcm9gXSAtIE9jY3VycyB3aGVuIGBhbW91bnQgPCAwYC4KCiMgRXZlbnRzCgoqIHRvcGljcyAtIGBbImFwcHJvdmUiLCBvd25lcjogQWRkcmVzcywgc3BlbmRlcjogQWRkcmVzc11gCiogZGF0YSAtIGBbYW1vdW50OiBpMTI4LCBsaXZlX3VudGlsX2xlZGdlcjogdTMyXWAAAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAA==",
        "AAAAAAAAAKpSZXR1cm5zIHRoZSBhbW91bnQgb2YgdG9rZW5zIGhlbGQgYnkgYGFjY291bnRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBhY2NvdW50YCAtIFRoZSBhZGRyZXNzIGZvciB3aGljaCB0aGUgYmFsYW5jZSBpcyBiZWluZyBxdWVyaWVkLgAAAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAZhc3NldHMAAAAAAAsAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAHxSZXR1cm5zIHRoZSBudW1iZXIgb2YgZGVjaW1hbHMgdXNlZCB0byByZXByZXNlbnQgYW1vdW50cyBvZiB0aGlzIHRva2VuLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAACGRlY2ltYWxzAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAIbWF4X21pbnQAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAACw==",
        "AAAAAAAAAn1UcmFuc2ZlcnMgYGFtb3VudGAgb2YgdG9rZW5zIGZyb20gYGZyb21gIHRvIGB0b2AuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgZnJvbWAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSB0b2tlbnMuCiogYHRvYCAtIFRoZSBhZGRyZXNzIHJlY2VpdmluZyB0aGUgdHJhbnNmZXJyZWQgdG9rZW5zLgoqIGBhbW91bnRgIC0gVGhlIGFtb3VudCBvZiB0b2tlbnMgdG8gYmUgdHJhbnNmZXJyZWQuCgojIEVycm9ycwoKKiBbYEZ1bmdpYmxlVG9rZW5FcnJvcjo6SW5zdWZmaWNpZW50QmFsYW5jZWBdIC0gV2hlbiBhdHRlbXB0aW5nIHRvCnRyYW5zZmVyIG1vcmUgdG9rZW5zIHRoYW4gYGZyb21gIGN1cnJlbnQgYmFsYW5jZS4KKiBbYEZ1bmdpYmxlVG9rZW5FcnJvcjo6TGVzc1RoYW5aZXJvYF0gLSBXaGVuIGBhbW91bnQgPCAwYC4KCiMgRXZlbnRzCgoqIHRvcGljcyAtIGBbInRyYW5zZmVyIiwgZnJvbTogQWRkcmVzcywgdG86IEFkZHJlc3NdYAoqIGRhdGEgLSBgYW1vdW50OiBpMTI4YCAod2hlbiBgdG9gIGhhcyBubyBtdXhlZCBJRCkKKiBkYXRhIC0gYHt0b19tdXhlZF9pZDogT3B0aW9uPHU2ND4sIGFtb3VudDogaTEyOH1gICh3aGVuIGB0b2AgaGFzIGEKbXV4ZWQgSUQpAAAAAAAACHRyYW5zZmVyAAAAAwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAAUAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAAEAAAAAAAAAAZhc3NldHMAAAAAAAsAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAhvcGVyYXRvcgAAABMAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAPBSZXR1cm5zIHRoZSBhbW91bnQgb2YgdG9rZW5zIGEgYHNwZW5kZXJgIGlzIGFsbG93ZWQgdG8gc3BlbmQgb24gYmVoYWxmCm9mIGFuIGBvd25lcmAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gVGhlIGFkZHJlc3MgaG9sZGluZyB0aGUgdG9rZW5zLgoqIGBzcGVuZGVyYCAtIFRoZSBhZGRyZXNzIGF1dGhvcml6ZWQgdG8gc3BlbmQgdGhlIHRva2Vucy4AAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAdzcGVuZGVyAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAJYnVybl9mcm9tAAAAAAAAAwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAHtPcGVyYXRvcjogZnVuZHMgYSBjYXJkIHNwZW5kIGZyb20gdGhlIGNhcmQgYmFsYW5jZSBmaXJzdCwgdGhlbiBjcmVkaXQKKGVhcmxpZXN0IGVzY3JpdHVyYSBmaXJzdCksIHBheWluZyBgY2FyZF9zZXR0bGVtZW50YC4AAAAACWNhcmRfZHJhdwAAAAAAAAMAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAhhdXRoX3JlZgAAA+4AAAAgAAAAAQAAA+kAAAfQAAAACkRyYXdSZXN1bHQAAAAAAAM=",
        "AAAAAAAAAAAAAAAJZHJhd191c2VkAAAAAAAAAQAAAAAAAAAIYXV0aF9yZWYAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAAE5Ob3RlIGNvbnRyYWN0IG9ubHkuIFNvcm9iYW4gZm9yYmlkcyByZS1lbnRyYW5jeSwgc28gdGhlIG5vdGUgcGFzc2VzIGl0cyB0ZXJtcy4AAAAAAAlvcGVuX2xpbmUAAAAAAAAEAAAAAAAAAAdub3RlX2lkAAAAAAQAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAQYWdlbnRfY29tbWlzc2lvbgAAAAsAAAAAAAAADWVzY3JpdHVyYV9kYXkAAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAElPcGVyYXRvciwgYWZ0ZXIgdGhlIGdyYWNlIGRlYWRsaW5lOiBsb3NzZXMgaGl0IGp1bmlvciBmaXJzdCwgdGhlbiBzZW5pb3IuAAAAAAAACXdyaXRlX29mZgAAAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAKY2xhaW1fZmVlcwAAAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKbWF4X3JlZGVlbQAAAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAALYWdlbnRfc3RhdGUAAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAB9AAAAAKQWdlbnRTdGF0ZQAA",
        "AAAAAAAAAAAAAAALZGVtb19vZmZzZXQAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAEhUaGUgYWdlbnQncyBvbi1jaGFpbiBjb25zZW50IChwYXNza2V5KSBmb3IgdGhlIG9wZXJhdG9yIHRvIGRyYXcgYnkgY2FyZC4AAAALZW5hYmxlX2NhcmQAAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAALbWF4X2RlcG9zaXQAAAAAAQAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAALcXVlcnlfYXNzZXQAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAALc2V0X2Jsb2NrZWQAAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAdibG9ja2VkAAAAAAEAAAAA",
        "AAAAAAAAAAAAAAAMZGlzYWJsZV9jYXJkAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAMbWF4X3dpdGhkcmF3AAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMcHJldmlld19taW50AAAAAQAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMcHJvdG9jb2xfbm93AAAAAAAAAAEAAAAG",
        "AAAAAAAAAExBY2NvdW50aW5nLWJhc2VkIChub3QgYmFsYW5jZS1iYXNlZCk6IGRvbmF0aW9ucyBjYW5ub3QgbW92ZSB0aGUgc2hhcmUgcHJpY2UuAAAADHRvdGFsX2Fzc2V0cwAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAAMdG90YWxfc3VwcGx5AAAAAAAAAAEAAAAL",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAcAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAAAAAAAD2NhcmRfc2V0dGxlbWVudAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAADW5vdGVfY29udHJhY3QAAAAAAAATAAAAAAAAAAZwYXJhbXMAAAAAB9AAAAAGUGFyYW1zAAAAAAAA",
        "AAAAAAAAAERBZG1pbiwgZGVtbyBtb2RlIG9ubHk6IGFjY3J1ZSwgdGhlbiBtb3ZlIHRoZSBwcm90b2NvbCBjbG9jayBmb3J3YXJkLgAAAA1hZHZhbmNlX2Nsb2NrAAAAAAAAAQAAAAAAAAAEc2VjcwAAAAYAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAA2dUcmFuc2ZlcnMgYGFtb3VudGAgb2YgdG9rZW5zIGZyb20gYGZyb21gIHRvIGB0b2AgdXNpbmcgdGhlCmFsbG93YW5jZSBtZWNoYW5pc20uIGBhbW91bnRgIGlzIHRoZW4gZGVkdWN0ZWQgZnJvbSBgc3BlbmRlcmAKYWxsb3dhbmNlLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3MgYXV0aG9yaXppbmcgdGhlIHRyYW5zZmVyLCBhbmQgaGF2aW5nIGl0cwphbGxvd2FuY2UgY29uc3VtZWQgZHVyaW5nIHRoZSB0cmFuc2Zlci4KKiBgZnJvbWAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSB0b2tlbnMgd2hpY2ggd2lsbCBiZSB0cmFuc2ZlcnJlZC4KKiBgdG9gIC0gVGhlIGFkZHJlc3MgcmVjZWl2aW5nIHRoZSB0cmFuc2ZlcnJlZCB0b2tlbnMuCiogYGFtb3VudGAgLSBUaGUgYW1vdW50IG9mIHRva2VucyB0byBiZSB0cmFuc2ZlcnJlZC4KCiMgRXJyb3JzCgoqIFtgRnVuZ2libGVUb2tlbkVycm9yOjpJbnN1ZmZpY2llbnRCYWxhbmNlYF0gLSBXaGVuIGF0dGVtcHRpbmcgdG8KdHJhbnNmZXIgbW9yZSB0b2tlbnMgdGhhbiBgZnJvbWAgY3VycmVudCBiYWxhbmNlLgoqIFtgRnVuZ2libGVUb2tlbkVycm9yOjpMZXNzVGhhblplcm9gXSAtIFdoZW4gYGFtb3VudCA8IDBgLgoqIFtgRnVuZ2libGVUb2tlbkVycm9yOjpJbnN1ZmZpY2llbnRBbGxvd2FuY2VgXSAtIFdoZW4gYXR0ZW1wdGluZyB0bwp0cmFuc2ZlciBtb3JlIHRva2VucyB0aGFuIGBzcGVuZGVyYCBjdXJyZW50IGFsbG93YW5jZS4KCiMgRXZlbnRzCgoqIHRvcGljcyAtIGBbInRyYW5zZmVyIiwgZnJvbTogQWRkcmVzcywgdG86IEFkZHJlc3NdYAoqIGRhdGEgLSBgW2Ftb3VudDogaTEyOF1gAAAAAA10cmFuc2Zlcl9mcm9tAAAAAAAABAAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAAOYWdlbnRfcG9zaXRpb24AAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAEAAAfQAAAADUFnZW50UG9zaXRpb24AAAA=",
        "AAAAAAAAAAAAAAAOanVuaW9yX2RlcG9zaXQAAAAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAOcHJldmlld19yZWRlZW0AAAAAAAEAAAAAAAAABnNoYXJlcwAAAAAACwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAPanVuaW9yX3dpdGhkcmF3AAAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAPcHJldmlld19kZXBvc2l0AAAAAAEAAAAAAAAABmFzc2V0cwAAAAAACwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAQcHJldmlld193aXRoZHJhdwAAAAEAAAAAAAAABmFzc2V0cwAAAAAACwAAAAEAAAAL",
        "AAAAAAAAADRBZ2VudCAocGFzc2tleSk6IG1vdmVzIGNhcmQgYmFsYW5jZSBvdXQgb2YgdGhlIHBvb2wuAAAAEHdpdGhkcmF3X2JhbGFuY2UAAAADAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAACdG8AAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAARY29udmVydF90b19hc3NldHMAAAAAAAABAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAABAAAACw==",
        "AAAAAAAAAAAAAAARY29udmVydF90b19zaGFyZXMAAAAAAAABAAAAAAAAAAZhc3NldHMAAAAAAAsAAAABAAAACw==",
        "AAAAAQAAAAAAAAAAAAAABExpbmUAAAAHAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAADGNyZWRpdF9saW1pdAAAAAsAAAAAAAAADWVzY3JpdHVyYV9kYXkAAAAAAAAEAAAAAAAAAAdub3RlX2lkAAAAAAQAAAAAAAAACXByaW5jaXBhbAAAAAAAAAsAAAAAAAAAC3NjYWxlZF9kZWJ0AAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApMaW5lU3RhdHVzAAA=",
        "AAAAAQAAAAAAAAAAAAAABlBhcmFtcwAAAAAABwAAAAAAAAANYWdlbnRfYXByX2JwcwAAAAAAAAQAAAAAAAAACWRlbW9fbW9kZQAAAAAAAAEAAAAAAAAAEWdyYWNlX3BlcmlvZF9zZWNzAAAAAAAABgAAAAAAAAAHbHR2X2JwcwAAAAAEAAAAAAAAAAxtYXhfbGV2ZXJhZ2UAAAAEAAAAAAAAABBwcm90b2NvbF9mZWVfYnBzAAAABAAAAAAAAAARc2VuaW9yX3RhcmdldF9icHMAAAAAAAAE",
        "AAAAAQAAAAAAAAAAAAAACExpbmVWaWV3AAAABAAAAAAAAAAJYXZhaWxhYmxlAAAAAAAACwAAAAAAAAAEZGVidAAAAAsAAAAAAAAACGludGVyZXN0AAAACwAAAAAAAAAEbGluZQAAB9AAAAAETGluZQ==",
        "AAAAAQAAAWtQb29sLXdpZGUgbnVtYmVycywgY29tcHV0ZWQgYWdhaW5zdCBhIG5vbi1tdXRhdGluZyBwcmV2aWV3IG9mIGBhY2NydWUoKWAuCgotIGBzaGFyZV9wcmljZV9zY2FsZWRgID0gKHRvdGFsX2Fzc2V0cyArIDEpIMOXIFNDQUxFIC8gKHN1cHBseSArIDEpOiBhc3NldHMgcGVyIHNoYXJlIMOXIDEwXjE4LgotIGB1dGlsaXphdGlvbl9icHNgID0gdG90YWxfZGVidCDDlyBCUFMgLyAoc2VuaW9yX2Fzc2V0cyArIGp1bmlvcl9hc3NldHMpLCAwIHdoZW4gdGhlIGRlbm9taW5hdG9yIGlzIDAuCi0gYGxldmVyYWdlX3gxMDBgID0gdG90YWxfZGVidCDDlyAxMDAgLyBqdW5pb3JfYXNzZXRzICgwIHdpdGggbm8gZGVidCwgdTMyOjpNQVgtY2FwcGVkKS4AAAAAAAAAAAlQb29sU3RhdHMAAAAAAAARAAAAAAAAAAxib3Jyb3dfaW5kZXgAAAALAAAAAAAAAAxmZWVzX2FjY3J1ZWQAAAALAAAAAAAAAA1qdW5pb3JfYXNzZXRzAAAAAAAACwAAAAAAAAAIbGVuZGFibGUAAAALAAAAAAAAABFsZXZlcmFnZV9oZWFkcm9vbQAAAAAAAAsAAAAAAAAADWxldmVyYWdlX3gxMDAAAAAAAAAEAAAAAAAAAAZwYXJhbXMAAAAAB9AAAAAGUGFyYW1zAAAAAAAAAAAACXBvb2xfY2FzaAAAAAAAAAsAAAAAAAAADHByb3RvY29sX25vdwAAAAYAAAAAAAAADXNlbmlvcl9hc3NldHMAAAAAAAALAAAAAAAAABJzaGFyZV9wcmljZV9zY2FsZWQAAAAAAAsAAAAAAAAADHNoYXJlX3N1cHBseQAAAAsAAAAAAAAAE3RvdGFsX2NhcmRfYmFsYW5jZXMAAAAACwAAAAAAAAAKdG90YWxfZGVidAAAAAAACwAAAAAAAAAPdG90YWxfcHJpbmNpcGFsAAAAAAsAAAAAAAAAD3V0aWxpemF0aW9uX2JwcwAAAAAEAAAAAAAAABF3cml0dGVuX29mZl90b3RhbAAAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAACkFnZW50U3RhdGUAAAAAAAgAAAAAAAAADGFjdGl2ZV9saW5lcwAAA+oAAAAEAAAAAAAAAAdibG9ja2VkAAAAAAEAAAAAAAAADGNhcmRfYmFsYW5jZQAAAAsAAAAAAAAADGNhcmRfZW5hYmxlZAAAAAEAAAAAAAAAEWNhcnJpZWRfcHJpbmNpcGFsAAAAAAAACwAAAAAAAAAOY2FycmllZF9zY2FsZWQAAAAAAAsAAAAAAAAADmdyYWNlX2RlYWRsaW5lAAAAAAPoAAAABgAAAAAAAAARd3JpdHRlbl9vZmZfdG90YWwAAAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAACkRyYXdSZXN1bHQAAAAAAAIAAAAAAAAADGZyb21fYmFsYW5jZQAAAAsAAAAAAAAAC2Zyb21fY3JlZGl0AAAAAAs=",
        "AAAAAgAAAAAAAAAAAAAACkxpbmVTdGF0dXMAAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAADhTdGF0aWMgd2lyaW5nIG9mIHRoZSBwb29sIChoZWxwZXIgdmlldyBmb3IgdGhlIGJhY2tlbmQpLgAAAAAAAAAKUG9vbENvbmZpZwAAAAAABgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAD2NhcmRfc2V0dGxlbWVudAAAAAATAAAAAAAAAA1ub3RlX2NvbnRyYWN0AAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAh0cmVhc3VyeQAAABM=",
        "AAAAAQAAAAAAAAAAAAAADUFnZW50UG9zaXRpb24AAAAAAAAKAAAAAAAAABBhdmFpbGFibGVfY3JlZGl0AAAACwAAAAAAAAAHYmxvY2tlZAAAAAABAAAAAAAAAA5ib3Jyb3dhYmxlX25vdwAAAAAACwAAAAAAAAAMY2FyZF9iYWxhbmNlAAAACwAAAAAAAAAMY2FyZF9lbmFibGVkAAAAAQAAAAAAAAAMY2FycmllZF9kZWJ0AAAACwAAAAAAAAAOZ3JhY2VfZGVhZGxpbmUAAAAAA+gAAAAGAAAAAAAAAAVsaW5lcwAAAAAAA+oAAAfQAAAACExpbmVWaWV3AAAAAAAAAAp0b3RhbF9kZWJ0AAAAAAALAAAAAAAAAA90b3RhbF9wcmluY2lwYWwAAAAACw==",
        "AAAABQAAAAAAAAAAAAAACENhcmREcmF3AAAAAQAAAAljYXJkX2RyYXcAAAAAAAAFAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAxmcm9tX2JhbGFuY2UAAAALAAAAAAAAAAAAAAALZnJvbV9jcmVkaXQAAAAACwAAAAAAAAAAAAAACGF1dGhfcmVmAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAACkJsb2NrZWRTZXQAAAAAAAEAAAALYmxvY2tlZF9zZXQAAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAAAAAAAAHYmxvY2tlZAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAACkxpbmVPcGVuZWQAAAAAAAEAAAALbGluZV9vcGVuZWQAAAAAAwAAAAAAAAAHbm90ZV9pZAAAAAAEAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAAAAAAAAMY3JlZGl0X2xpbWl0AAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAC0NhcmRFbmFibGVkAAAAAAEAAAAMY2FyZF9lbmFibGVkAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC0ZlZXNDbGFpbWVkAAAAAAEAAAAMZmVlc19jbGFpbWVkAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC05vdGVTZXR0bGVkAAAAAAEAAAAMbm90ZV9zZXR0bGVkAAAACAAAAAAAAAAHbm90ZV9pZAAAAAAEAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAAAAAAAAQdG90YWxfY29tbWlzc2lvbgAAAAsAAAAAAAAAAAAAAAtkZWJ0X3JlcGFpZAAAAAALAAAAAAAAAAAAAAANaW50ZXJlc3RfcGFpZAAAAAAAAAsAAAAAAAAAAAAAAA5jYXJyaWVkX3JlcGFpZAAAAAAACwAAAAAAAAAAAAAADGFnZW50X3BheW91dAAAAAsAAAAAAAAAAAAAAA5qdW5pb3JfZGVwb3NpdAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADUNsb2NrQWR2YW5jZWQAAAAAAAABAAAADmNsb2NrX2FkdmFuY2VkAAAAAAACAAAAAAAAAARzZWNzAAAABgAAAAAAAAAAAAAADHByb3RvY29sX25vdwAAAAYAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADUp1bmlvckRlcG9zaXQAAAAAAAABAAAADmp1bmlvcl9kZXBvc2l0AAAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADU5vdGVDYW5jZWxsZWQAAAAAAAABAAAADm5vdGVfY2FuY2VsbGVkAAAAAAAEAAAAAAAAAAdub3RlX2lkAAAAAAQAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAAAAAAxkZWJ0X2NhcnJpZWQAAAALAAAAAAAAAAAAAAAOZ3JhY2VfZGVhZGxpbmUAAAAAA+gAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkRlYnRXcml0dGVuT2ZmAAAAAAABAAAAEGRlYnRfd3JpdHRlbl9vZmYAAAAEAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAtqdW5pb3JfbG9zcwAAAAALAAAAAAAAAAAAAAALc2VuaW9yX2xvc3MAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADkp1bmlvcldpdGhkcmF3AAAAAAABAAAAD2p1bmlvcl93aXRoZHJhdwAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEEJhbGFuY2VXaXRoZHJhd24AAAABAAAAEWJhbGFuY2Vfd2l0aGRyYXduAAAAAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAACdG8AAAAAABMAAAAAAAAAAg==",
        "AAAABAAAAD9FcnJvciBjb2RlcyBzaGFyZWQgYnkgYWxsIGV4cGxvcmFkb3IgYWR2YW5jZSBjb250cmFjdHMgKMKnNy4zKS4AAAAAAAAAAAVFcnJvcgAAAAAAABsAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAABAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAABJJbnN1ZmZpY2llbnRDcmVkaXQAAAAAAAQAAAAAAAAAFUluc3VmZmljaWVudExpcXVpZGl0eQAAAAAAAAUAAAAAAAAAE0xldmVyYWdlQ2FwRXhjZWVkZWQAAAAABgAAAAAAAAAOQ2FyZE5vdEVuYWJsZWQAAAAAAAcAAAAAAAAADEFnZW50QmxvY2tlZAAAAAgAAAAAAAAADUxpbmVOb3RBY3RpdmUAAAAAAAAJAAAAAAAAAAxHcmFjZU5vdE92ZXIAAAAKAAAAAAAAABFOb3RoaW5nVG9Xcml0ZU9mZgAAAAAAAAsAAAAAAAAADUR1cGxpY2F0ZURyYXcAAAAAAAAMAAAAAAAAAAxJbnZhbGlkUHJvb2YAAAANAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAADgAAAAAAAAAOQ29tbWl0bWVudFVzZWQAAAAAAA8AAAAAAAAAD0VzY3JpdHVyYUluUGFzdAAAAAAQAAAAAAAAAAlTb3VsYm91bmQAAAAAAAARAAAAAAAAAAtVbmtub3duTm90ZQAAAAASAAAAAAAAAAxNYXRoT3ZlcmZsb3cAAAATAAAAAAAAABBEZW1vTW9kZURpc2FibGVkAAAAFAAAAAAAAAANSW52YWxpZFBhcmFtcwAAAAAAABUAAAAAAAAAFENsb2NrQWR2YW5jZVRvb0xhcmdlAAAAFgAAAAAAAAATRmF1Y2V0TGltaXRFeGNlZWRlZAAAAAAXAAAAAAAAABNJbnN1ZmZpY2llbnRCYWxhbmNlAAAAABgAAAAAAAAADkV4Y2VlZHNNYXhpbXVtAAAAAAAZAAAAAAAAAApQb29sTm90U2V0AAAAAAAaAAAAAAAAABFOb25DYW5vbmljYWxGaWVsZAAAAAAAABs=",
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
        stats: this.txFromJSON<PoolStats>,
        accrue: this.txFromJSON<null>,
        cancel: this.txFromJSON<Result<void>>,
        config: this.txFromJSON<PoolConfig>,
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
        draw_used: this.txFromJSON<boolean>,
        open_line: this.txFromJSON<Result<void>>,
        write_off: this.txFromJSON<Result<void>>,
        claim_fees: this.txFromJSON<Result<void>>,
        max_redeem: this.txFromJSON<i128>,
        agent_state: this.txFromJSON<AgentState>,
        demo_offset: this.txFromJSON<u64>,
        enable_card: this.txFromJSON<null>,
        max_deposit: this.txFromJSON<i128>,
        query_asset: this.txFromJSON<string>,
        set_blocked: this.txFromJSON<null>,
        disable_card: this.txFromJSON<null>,
        max_withdraw: this.txFromJSON<i128>,
        preview_mint: this.txFromJSON<i128>,
        protocol_now: this.txFromJSON<u64>,
        total_assets: this.txFromJSON<i128>,
        total_supply: this.txFromJSON<i128>,
        advance_clock: this.txFromJSON<Result<u64>>,
        transfer_from: this.txFromJSON<null>,
        agent_position: this.txFromJSON<AgentPosition>,
        junior_deposit: this.txFromJSON<Result<void>>,
        preview_redeem: this.txFromJSON<i128>,
        junior_withdraw: this.txFromJSON<Result<void>>,
        preview_deposit: this.txFromJSON<i128>,
        preview_withdraw: this.txFromJSON<i128>,
        withdraw_balance: this.txFromJSON<Result<void>>,
        convert_to_assets: this.txFromJSON<i128>,
        convert_to_shares: this.txFromJSON<i128>
  }
}