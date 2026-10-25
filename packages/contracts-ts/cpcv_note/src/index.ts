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
    contractId: "CDJW3IE5NCBTSBENXYYZ6CFLTCHPOXJK4VVNKDULLZ6FNOR26ELUXIUV",
  }
} as const




export interface Note {
  agent: string;
  /**
 * stroops, floor(total / 2)
 */
agent_commission: i128;
  commitment: Buffer;
  /**
 * days since Unix epoch
 */
escritura_day: u32;
  /**
 * stroops, total − agent
 */
explorador_commission: i128;
  id: u32;
  /**
 * protocol clock
 */
minted_at: u64;
  nullifier: Buffer;
  proof: Groth16Proof;
  status: NoteStatus;
  /**
 * stroops
 */
total_commission: i128;
}

export type NoteStatus = {tag: "Active", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void};


/**
 * Groth16 proof. `a` is stored NEGATED (−A) so verification is a single
 * product-of-pairings == 1 check (§8.5).
 */
export interface Groth16Proof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}


export interface VerificationKey {
  alpha: Buffer;
  beta: Buffer;
  delta: Buffer;
  gamma: Buffer;
  /**
 * Length 10 (9 public inputs + 1).
 */
ic: Array<Buffer>;
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


export const NonFungibleTokenError = {
  /**
   * Indicates a non-existent `token_id`.
   */
  200: {message:"NonExistentToken"},
  /**
   * Indicates an error related to the ownership over a particular token.
   * Used in transfers.
   */
  201: {message:"IncorrectOwner"},
  /**
   * Indicates a failure with the `operator`s approval. Used in transfers.
   */
  202: {message:"InsufficientApproval"},
  /**
   * Indicates a failure with the `approver` of a token to be approved. Used
   * in approvals.
   */
  203: {message:"InvalidApprover"},
  /**
   * Indicates an invalid value for `live_until_ledger` when setting
   * approvals.
   */
  204: {message:"InvalidLiveUntilLedger"},
  /**
   * Indicates overflow when adding two values
   */
  205: {message:"MathOverflow"},
  /**
   * Indicates all possible `token_id`s are already in use.
   */
  206: {message:"TokenIDsAreDepleted"},
  /**
   * Indicates an invalid amount to batch mint in `consecutive` extension.
   */
  207: {message:"InvalidAmount"},
  /**
   * Indicates the token does not exist in owner's list.
   */
  208: {message:"TokenNotFoundInOwnerList"},
  /**
   * Indicates the token does not exist in global list.
   */
  209: {message:"TokenNotFoundInGlobalList"},
  /**
   * Indicates access to unset metadata.
   */
  210: {message:"UnsetMetadata"},
  /**
   * Indicates the length of the base URI exceeds the maximum allowed.
   */
  211: {message:"BaseUriMaxLenExceeded"},
  /**
   * Indicates the royalty amount is higher than 10_000 (100%) basis points.
   */
  212: {message:"InvalidRoyaltyAmount"},
  /**
   * Indicates the length of the name exceeds the maximum allowed.
   */
  213: {message:"NameMaxLenExceeded"},
  /**
   * Indicates the length of the symbol exceeds the maximum allowed.
   */
  214: {message:"SymbolMaxLenExceeded"}
}

export interface Client {
  /**
   * Construct and simulate a get transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get: ({id}: {id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Note>>>

  /**
   * Construct and simulate a list transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Notes with ids in `[start, start + limit)` (ids start at 1), `limit ≤ 50`.
   */
  list: ({start, limit}: {start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Note>>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Operator: verifies the CPCV proof and mints a soulbound note to `to`.
   */
  mint: ({to, proof, total_commission_cents, escritura_day, commitment, nullifier}: {to: string, proof: Groth16Proof, total_commission_cents: u64, escritura_day: u32, commitment: Buffer, nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token collection name.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pool: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token collection symbol.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve: ({approver, approved, token_id, live_until_ledger}: {approver: string, approved: string, token_id: u32, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the number of tokens owned by `account`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `account` - The address for which the balance is being queried.
   */
  balance: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a attester transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  attester: (options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

  /**
   * Construct and simulate a base_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  base_uri: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a notes_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  notes_of: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u32>>>

  /**
   * Construct and simulate a owner_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the owner of the token with `token_id`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   */
  owner_of: ({token_id}: {token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin, once: wires the `advance_pool` contract.
   */
  set_pool: ({pool}: {pool: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({from, to, token_id}: {from: string, to: string, token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a token_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the Uniform Resource Identifier (URI) for the token with
   * `token_id`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   * 
   * # Notes
   * 
   * If the token does not exist, this function is expected to panic.
   */
  token_uri: ({token_id}: {token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pool only: records a deal outcome.
   */
  set_status: ({id, status}: {id: u32, status: NoteStatus}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a agent_field transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_field: ({addr}: {addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a get_approved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the account approved for the token with `token_id`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   * 
   * # Errors
   * 
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   */
  get_approved: ({token_id}: {token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_from: ({spender, from, to, token_id}: {spender: string, from: string, to: string, token_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  nullifier_used: ({nullifier}: {nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a approve_for_all transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve_for_all: ({owner, operator, live_until_ledger}: {owner: string, operator: string, live_until_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a verification_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  verification_key: (options?: MethodOptions) => Promise<AssembledTransaction<VerificationKey>>

  /**
   * Construct and simulate a is_approved_for_all transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns whether the `operator` is allowed to manage all the assets of
   * `owner`.
   * 
   * # Arguments
   * 
   * * `e` - Access to the Soroban environment.
   * * `owner` - Account of the token's owner.
   * * `operator` - Account to be checked.
   */
  is_approved_for_all: ({owner, operator}: {owner: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, operator, attester_ax, attester_ay, nullifier_secret_commitment, vk, base_uri}: {admin: string, operator: string, attester_ax: Buffer, attester_ay: Buffer, nullifier_secret_commitment: Buffer, vk: VerificationKey, base_uri: string},
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
    return ContractClient.deploy({admin, operator, attester_ax, attester_ay, nullifier_secret_commitment, vk, base_uri}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABQAAAAAAAAAAAAAACk5vdGVNaW50ZWQAAAAAAAEAAAALbm90ZV9taW50ZWQAAAAABwAAAAAAAAACaWQAAAAAAAQAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAAAAABB0b3RhbF9jb21taXNzaW9uAAAACwAAAAAAAAAAAAAAEGFnZW50X2NvbW1pc3Npb24AAAALAAAAAAAAAAAAAAANZXNjcml0dXJhX2RheQAAAAAAAAQAAAAAAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEU5vdGVTdGF0dXNDaGFuZ2VkAAAAAAAAAQAAABNub3RlX3N0YXR1c19jaGFuZ2VkAAAAAAIAAAAAAAAAAmlkAAAAAAAEAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAfQAAAACk5vdGVTdGF0dXMAAAAAAAAAAAAC",
        "AAAAAAAAAAAAAAADZ2V0AAAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAQAAA+kAAAfQAAAABE5vdGUAAAAD",
        "AAAAAAAAAExOb3RlcyB3aXRoIGlkcyBpbiBgW3N0YXJ0LCBzdGFydCArIGxpbWl0KWAgKGlkcyBzdGFydCBhdCAxKSwgYGxpbWl0IOKJpCA1MGAuAAAABGxpc3QAAAACAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAROb3Rl",
        "AAAAAAAAAEVPcGVyYXRvcjogdmVyaWZpZXMgdGhlIENQQ1YgcHJvb2YgYW5kIG1pbnRzIGEgc291bGJvdW5kIG5vdGUgdG8gYHRvYC4AAAAAAAAEbWludAAAAAYAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAMR3JvdGgxNlByb29mAAAAAAAAABZ0b3RhbF9jb21taXNzaW9uX2NlbnRzAAAAAAAGAAAAAAAAAA1lc2NyaXR1cmFfZGF5AAAAAAAABAAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAQAAA+kAAAAEAAAAAw==",
        "AAAAAAAAAFtSZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIG5hbWUuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAARuYW1lAAAAAAAAAAEAAAAQ",
        "AAAAAAAAAAAAAAAEcG9vbAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAAAAAAAFY291bnQAAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAF1SZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIHN5bWJvbC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAHYXBwcm92ZQAAAAAEAAAAAAAAAAhhcHByb3ZlcgAAABMAAAAAAAAACGFwcHJvdmVkAAAAEwAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAKtSZXR1cm5zIHRoZSBudW1iZXIgb2YgdG9rZW5zIG93bmVkIGJ5IGBhY2NvdW50YC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYWNjb3VudGAgLSBUaGUgYWRkcmVzcyBmb3Igd2hpY2ggdGhlIGJhbGFuY2UgaXMgYmVpbmcgcXVlcmllZC4AAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAIYXR0ZXN0ZXIAAAAAAAAAAQAAA+oAAAPuAAAAIA==",
        "AAAAAAAAAAAAAAAIYmFzZV91cmkAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAIbm90ZXNfb2YAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAD6gAAAAQ=",
        "AAAAAAAAAOVSZXR1cm5zIHRoZSBvd25lciBvZiB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAACG93bmVyX29mAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAABM=",
        "AAAAAAAAAC9BZG1pbiwgb25jZTogd2lyZXMgdGhlIGBhZHZhbmNlX3Bvb2xgIGNvbnRyYWN0LgAAAAAIc2V0X3Bvb2wAAAABAAAAAAAAAARwb29sAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAACHRva2VuX2lkAAAABAAAAAA=",
        "AAAAAAAAAPVSZXR1cm5zIHRoZSBVbmlmb3JtIFJlc291cmNlIElkZW50aWZpZXIgKFVSSSkgZm9yIHRoZSB0b2tlbiB3aXRoCmB0b2tlbl9pZGAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHRva2VuX2lkYCAtIFRva2VuIElEIGFzIGEgbnVtYmVyLgoKIyBOb3RlcwoKSWYgdGhlIHRva2VuIGRvZXMgbm90IGV4aXN0LCB0aGlzIGZ1bmN0aW9uIGlzIGV4cGVjdGVkIHRvIHBhbmljLgAAAAAAAAl0b2tlbl91cmkAAAAAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAABAAAAEA==",
        "AAAAAAAAACJQb29sIG9ubHk6IHJlY29yZHMgYSBkZWFsIG91dGNvbWUuAAAAAAAKc2V0X3N0YXR1cwAAAAAAAgAAAAAAAAACaWQAAAAAAAQAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApOb3RlU3RhdHVzAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAALYWdlbnRfZmllbGQAAAAAAQAAAAAAAAAEYWRkcgAAABMAAAABAAAD7gAAACA=",
        "AAAAAAAAAPFSZXR1cm5zIHRoZSBhY2NvdW50IGFwcHJvdmVkIGZvciB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAADGdldF9hcHByb3ZlZAAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAcAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAthdHRlc3Rlcl9heAAAAAPuAAAAIAAAAAAAAAALYXR0ZXN0ZXJfYXkAAAAD7gAAACAAAAAAAAAAG251bGxpZmllcl9zZWNyZXRfY29tbWl0bWVudAAAAAPuAAAAIAAAAAAAAAACdmsAAAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAAIYmFzZV91cmkAAAAQAAAAAA==",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAObnVsbGlmaWVyX3VzZWQAAAAAAAEAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAPYXBwcm92ZV9mb3JfYWxsAAAAAAMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAQdmVyaWZpY2F0aW9uX2tleQAAAAAAAAABAAAH0AAAAA9WZXJpZmljYXRpb25LZXkA",
        "AAAAAAAAANdSZXR1cm5zIHdoZXRoZXIgdGhlIGBvcGVyYXRvcmAgaXMgYWxsb3dlZCB0byBtYW5hZ2UgYWxsIHRoZSBhc3NldHMgb2YKYG93bmVyYC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gQWNjb3VudCBvZiB0aGUgdG9rZW4ncyBvd25lci4KKiBgb3BlcmF0b3JgIC0gQWNjb3VudCB0byBiZSBjaGVja2VkLgAAAAATaXNfYXBwcm92ZWRfZm9yX2FsbAAAAAACAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAAB",
        "AAAAAQAAAAAAAAAAAAAABE5vdGUAAAALAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAZc3Ryb29wcywgZmxvb3IodG90YWwgLyAyKQAAAAAAABBhZ2VudF9jb21taXNzaW9uAAAACwAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAVZGF5cyBzaW5jZSBVbml4IGVwb2NoAAAAAAAADWVzY3JpdHVyYV9kYXkAAAAAAAAEAAAAGHN0cm9vcHMsIHRvdGFsIOKIkiBhZ2VudAAAABVleHBsb3JhZG9yX2NvbW1pc3Npb24AAAAAAAALAAAAAAAAAAJpZAAAAAAABAAAAA5wcm90b2NvbCBjbG9jawAAAAAACW1pbnRlZF9hdAAAAAAAAAYAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAMR3JvdGgxNlByb29mAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAKTm90ZVN0YXR1cwAAAAAAB3N0cm9vcHMAAAAAEHRvdGFsX2NvbW1pc3Npb24AAAAL",
        "AAAAAgAAAAAAAAAAAAAACk5vdGVTdGF0dXMAAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAAG9Hcm90aDE2IHByb29mLiBgYWAgaXMgc3RvcmVkIE5FR0FURUQgKOKIkkEpIHNvIHZlcmlmaWNhdGlvbiBpcyBhIHNpbmdsZQpwcm9kdWN0LW9mLXBhaXJpbmdzID09IDEgY2hlY2sgKMKnOC41KS4AAAAAAAAAAAxHcm90aDE2UHJvb2YAAAADAAAAAAAAAAFhAAAAAAAD7gAAAEAAAAAAAAAAAWIAAAAAAAPuAAAAgAAAAAAAAAABYwAAAAAAA+4AAABA",
        "AAAAAQAAAAAAAAAAAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAFAAAAAAAAAAVhbHBoYQAAAAAAA+4AAABAAAAAAAAAAARiZXRhAAAD7gAAAIAAAAAAAAAABWRlbHRhAAAAAAAD7gAAAIAAAAAAAAAABWdhbW1hAAAAAAAD7gAAAIAAAAAgTGVuZ3RoIDEwICg5IHB1YmxpYyBpbnB1dHMgKyAxKS4AAAACaWMAAAAAA+oAAAPuAAAAQA==",
        "AAAABAAAAD9FcnJvciBjb2RlcyBzaGFyZWQgYnkgYWxsIGV4cGxvcmFkb3IgYWR2YW5jZSBjb250cmFjdHMgKMKnNy4zKS4AAAAAAAAAAAVFcnJvcgAAAAAAABsAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAABAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAABJJbnN1ZmZpY2llbnRDcmVkaXQAAAAAAAQAAAAAAAAAFUluc3VmZmljaWVudExpcXVpZGl0eQAAAAAAAAUAAAAAAAAAE0xldmVyYWdlQ2FwRXhjZWVkZWQAAAAABgAAAAAAAAAOQ2FyZE5vdEVuYWJsZWQAAAAAAAcAAAAAAAAADEFnZW50QmxvY2tlZAAAAAgAAAAAAAAADUxpbmVOb3RBY3RpdmUAAAAAAAAJAAAAAAAAAAxHcmFjZU5vdE92ZXIAAAAKAAAAAAAAABFOb3RoaW5nVG9Xcml0ZU9mZgAAAAAAAAsAAAAAAAAADUR1cGxpY2F0ZURyYXcAAAAAAAAMAAAAAAAAAAxJbnZhbGlkUHJvb2YAAAANAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAADgAAAAAAAAAOQ29tbWl0bWVudFVzZWQAAAAAAA8AAAAAAAAAD0VzY3JpdHVyYUluUGFzdAAAAAAQAAAAAAAAAAlTb3VsYm91bmQAAAAAAAARAAAAAAAAAAtVbmtub3duTm90ZQAAAAASAAAAAAAAAAxNYXRoT3ZlcmZsb3cAAAATAAAAAAAAABBEZW1vTW9kZURpc2FibGVkAAAAFAAAAAAAAAANSW52YWxpZFBhcmFtcwAAAAAAABUAAAAAAAAAFENsb2NrQWR2YW5jZVRvb0xhcmdlAAAAFgAAAAAAAAATRmF1Y2V0TGltaXRFeGNlZWRlZAAAAAAXAAAAAAAAABNJbnN1ZmZpY2llbnRCYWxhbmNlAAAAABgAAAAAAAAADkV4Y2VlZHNNYXhpbXVtAAAAAAAZAAAAAAAAAApQb29sTm90U2V0AAAAAAAaAAAAAAAAABFOb25DYW5vbmljYWxGaWVsZAAAAAAAABs=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSB0b2tlbiBpcyBtaW50ZWQuAAAAAAAAAAAAAARNaW50AAAAAQAAAARtaW50AAAAAgAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAAAAAAAg==",
        "AAAABAAAAAAAAAAAAAAAFU5vbkZ1bmdpYmxlVG9rZW5FcnJvcgAAAAAAAA8AAAAkSW5kaWNhdGVzIGEgbm9uLWV4aXN0ZW50IGB0b2tlbl9pZGAuAAAAEE5vbkV4aXN0ZW50VG9rZW4AAADIAAAAV0luZGljYXRlcyBhbiBlcnJvciByZWxhdGVkIHRvIHRoZSBvd25lcnNoaXAgb3ZlciBhIHBhcnRpY3VsYXIgdG9rZW4uClVzZWQgaW4gdHJhbnNmZXJzLgAAAAAOSW5jb3JyZWN0T3duZXIAAAAAAMkAAABFSW5kaWNhdGVzIGEgZmFpbHVyZSB3aXRoIHRoZSBgb3BlcmF0b3JgcyBhcHByb3ZhbC4gVXNlZCBpbiB0cmFuc2ZlcnMuAAAAAAAAFEluc3VmZmljaWVudEFwcHJvdmFsAAAAygAAAFVJbmRpY2F0ZXMgYSBmYWlsdXJlIHdpdGggdGhlIGBhcHByb3ZlcmAgb2YgYSB0b2tlbiB0byBiZSBhcHByb3ZlZC4gVXNlZAppbiBhcHByb3ZhbHMuAAAAAAAAD0ludmFsaWRBcHByb3ZlcgAAAADLAAAASkluZGljYXRlcyBhbiBpbnZhbGlkIHZhbHVlIGZvciBgbGl2ZV91bnRpbF9sZWRnZXJgIHdoZW4gc2V0dGluZwphcHByb3ZhbHMuAAAAAAAWSW52YWxpZExpdmVVbnRpbExlZGdlcgAAAAAAzAAAAClJbmRpY2F0ZXMgb3ZlcmZsb3cgd2hlbiBhZGRpbmcgdHdvIHZhbHVlcwAAAAAAAAxNYXRoT3ZlcmZsb3cAAADNAAAANkluZGljYXRlcyBhbGwgcG9zc2libGUgYHRva2VuX2lkYHMgYXJlIGFscmVhZHkgaW4gdXNlLgAAAAAAE1Rva2VuSURzQXJlRGVwbGV0ZWQAAAAAzgAAAEVJbmRpY2F0ZXMgYW4gaW52YWxpZCBhbW91bnQgdG8gYmF0Y2ggbWludCBpbiBgY29uc2VjdXRpdmVgIGV4dGVuc2lvbi4AAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAM8AAAAzSW5kaWNhdGVzIHRoZSB0b2tlbiBkb2VzIG5vdCBleGlzdCBpbiBvd25lcidzIGxpc3QuAAAAABhUb2tlbk5vdEZvdW5kSW5Pd25lckxpc3QAAADQAAAAMkluZGljYXRlcyB0aGUgdG9rZW4gZG9lcyBub3QgZXhpc3QgaW4gZ2xvYmFsIGxpc3QuAAAAAAAZVG9rZW5Ob3RGb3VuZEluR2xvYmFsTGlzdAAAAAAAANEAAAAjSW5kaWNhdGVzIGFjY2VzcyB0byB1bnNldCBtZXRhZGF0YS4AAAAADVVuc2V0TWV0YWRhdGEAAAAAAADSAAAAQUluZGljYXRlcyB0aGUgbGVuZ3RoIG9mIHRoZSBiYXNlIFVSSSBleGNlZWRzIHRoZSBtYXhpbXVtIGFsbG93ZWQuAAAAAAAAFUJhc2VVcmlNYXhMZW5FeGNlZWRlZAAAAAAAANMAAABHSW5kaWNhdGVzIHRoZSByb3lhbHR5IGFtb3VudCBpcyBoaWdoZXIgdGhhbiAxMF8wMDAgKDEwMCUpIGJhc2lzIHBvaW50cy4AAAAAFEludmFsaWRSb3lhbHR5QW1vdW50AAAA1AAAAD1JbmRpY2F0ZXMgdGhlIGxlbmd0aCBvZiB0aGUgbmFtZSBleGNlZWRzIHRoZSBtYXhpbXVtIGFsbG93ZWQuAAAAAAAAEk5hbWVNYXhMZW5FeGNlZWRlZAAAAAAA1QAAAD9JbmRpY2F0ZXMgdGhlIGxlbmd0aCBvZiB0aGUgc3ltYm9sIGV4Y2VlZHMgdGhlIG1heGltdW0gYWxsb3dlZC4AAAAAFFN5bWJvbE1heExlbkV4Y2VlZGVkAAAA1g==" ]),
      options
    )
  }
  public readonly fromJSON = {
    get: this.txFromJSON<Result<Note>>,
        list: this.txFromJSON<Array<Note>>,
        mint: this.txFromJSON<Result<u32>>,
        name: this.txFromJSON<string>,
        pool: this.txFromJSON<Option<string>>,
        count: this.txFromJSON<u32>,
        symbol: this.txFromJSON<string>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<u32>,
        attester: this.txFromJSON<Array<Buffer>>,
        base_uri: this.txFromJSON<string>,
        notes_of: this.txFromJSON<Array<u32>>,
        owner_of: this.txFromJSON<string>,
        set_pool: this.txFromJSON<Result<void>>,
        transfer: this.txFromJSON<null>,
        token_uri: this.txFromJSON<string>,
        set_status: this.txFromJSON<Result<void>>,
        agent_field: this.txFromJSON<Buffer>,
        get_approved: this.txFromJSON<Option<string>>,
        transfer_from: this.txFromJSON<null>,
        nullifier_used: this.txFromJSON<boolean>,
        approve_for_all: this.txFromJSON<null>,
        verification_key: this.txFromJSON<VerificationKey>,
        is_approved_for_all: this.txFromJSON<boolean>
  }
}