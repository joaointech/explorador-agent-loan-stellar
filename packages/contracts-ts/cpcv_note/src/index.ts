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
 * The proof parameters fixed at deploy time (public inputs 6–8). Lets anyone
 * rebuild a note's public signals from on-chain data alone.
 */
export interface AttesterParams {
  attester_ax: Buffer;
  attester_ay: Buffer;
  nullifier_secret_commitment: Buffer;
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
 * Groth16 verification key; `ic` has 10 entries (9 public inputs + 1).
 */
export interface VerificationKey {
  alpha: Buffer;
  beta: Buffer;
  delta: Buffer;
  gamma: Buffer;
  ic: Array<Buffer>;
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
   * Notes with id ≥ `start` (ids start at 1, so 0 and 1 both mean "from
   * the first"), in id order, at most `min(limit, 50)`.
   */
  list: ({start, limit}: {start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Note>>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verifies the CPCV attestation proof and mints the soulbound note to
   * `to` (operator only). Amounts are EUR cents; the note stores stroops.
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
   * Construct and simulate a count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Number of notes minted (ids run from 1 to count).
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
   * Construct and simulate a notes_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Note ids of `agent`, in mint order.
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
   * Wires the advance_pool contract (admin, once).
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
   * Settled / Cancelled, set by the pool (pool only).
   */
  set_status: ({id, status}: {id: u32, status: NoteStatus}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a agent_field transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `0x00 ‖ sha256(ScVal::Address XDR)[0..31]` (spec §8.4), the circuit's
   * public input 0. View helper for the TypeScript parity tests.
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
   * Construct and simulate a attester_params transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Attester public key and nullifier-secret commitment (public inputs 6–8).
   */
  attester_params: (options?: MethodOptions) => Promise<AssembledTransaction<AttesterParams>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAADZ2V0AAAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAQAAA+kAAAfQAAAABE5vdGUAAAAD",
        "AAAAAAAAAHlOb3RlcyB3aXRoIGlkIOKJpSBgc3RhcnRgIChpZHMgc3RhcnQgYXQgMSwgc28gMCBhbmQgMSBib3RoIG1lYW4gImZyb20KdGhlIGZpcnN0IiksIGluIGlkIG9yZGVyLCBhdCBtb3N0IGBtaW4obGltaXQsIDUwKWAuAAAAAAAABGxpc3QAAAACAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAROb3Rl",
        "AAAAAAAAAIlWZXJpZmllcyB0aGUgQ1BDViBhdHRlc3RhdGlvbiBwcm9vZiBhbmQgbWludHMgdGhlIHNvdWxib3VuZCBub3RlIHRvCmB0b2AgKG9wZXJhdG9yIG9ubHkpLiBBbW91bnRzIGFyZSBFVVIgY2VudHM7IHRoZSBub3RlIHN0b3JlcyBzdHJvb3BzLgAAAAAAAARtaW50AAAABgAAAAAAAAACdG8AAAAAABMAAAAAAAAABXByb29mAAAAAAAH0AAAAAxHcm90aDE2UHJvb2YAAAAAAAAAFnRvdGFsX2NvbW1pc3Npb25fY2VudHMAAAAAAAYAAAAAAAAADWVzY3JpdHVyYV9kYXkAAAAAAAAEAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAABAAAD6QAAAAQAAAAD",
        "AAAAAAAAAFtSZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIG5hbWUuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAARuYW1lAAAAAAAAAAEAAAAQ",
        "AAAAAAAAADFOdW1iZXIgb2Ygbm90ZXMgbWludGVkIChpZHMgcnVuIGZyb20gMSB0byBjb3VudCkuAAAAAAAABWNvdW50AAAAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAF1SZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIHN5bWJvbC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAHYXBwcm92ZQAAAAAEAAAAAAAAAAhhcHByb3ZlcgAAABMAAAAAAAAACGFwcHJvdmVkAAAAEwAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAKtSZXR1cm5zIHRoZSBudW1iZXIgb2YgdG9rZW5zIG93bmVkIGJ5IGBhY2NvdW50YC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYWNjb3VudGAgLSBUaGUgYWRkcmVzcyBmb3Igd2hpY2ggdGhlIGJhbGFuY2UgaXMgYmVpbmcgcXVlcmllZC4AAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAQ=",
        "AAAAAAAAACNOb3RlIGlkcyBvZiBgYWdlbnRgLCBpbiBtaW50IG9yZGVyLgAAAAAIbm90ZXNfb2YAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAD6gAAAAQ=",
        "AAAAAAAAAOVSZXR1cm5zIHRoZSBvd25lciBvZiB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAACG93bmVyX29mAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAABM=",
        "AAAAAAAAAC5XaXJlcyB0aGUgYWR2YW5jZV9wb29sIGNvbnRyYWN0IChhZG1pbiwgb25jZSkuAAAAAAAIc2V0X3Bvb2wAAAABAAAAAAAAAARwb29sAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAACHRva2VuX2lkAAAABAAAAAA=",
        "AAAAAAAAAPVSZXR1cm5zIHRoZSBVbmlmb3JtIFJlc291cmNlIElkZW50aWZpZXIgKFVSSSkgZm9yIHRoZSB0b2tlbiB3aXRoCmB0b2tlbl9pZGAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHRva2VuX2lkYCAtIFRva2VuIElEIGFzIGEgbnVtYmVyLgoKIyBOb3RlcwoKSWYgdGhlIHRva2VuIGRvZXMgbm90IGV4aXN0LCB0aGlzIGZ1bmN0aW9uIGlzIGV4cGVjdGVkIHRvIHBhbmljLgAAAAAAAAl0b2tlbl91cmkAAAAAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAABAAAAEA==",
        "AAAABQAAAEdFbWl0dGVkIHdoZW4gYSBub3RlIGlzIG1pbnRlZC4gVG9waWMgYG5vdGVfbWludGVkYDsgYW1vdW50cyBpbiBzdHJvb3BzLgAAAAAAAAAACk5vdGVNaW50ZWQAAAAAAAEAAAALbm90ZV9taW50ZWQAAAAABwAAAAAAAAACaWQAAAAAAAQAAAAAAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAAAAAAABB0b3RhbF9jb21taXNzaW9uAAAACwAAAAAAAAAAAAAAEGFnZW50X2NvbW1pc3Npb24AAAALAAAAAAAAAAAAAAANZXNjcml0dXJhX2RheQAAAAAAAAQAAAAAAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAAAAAAADFTZXR0bGVkIC8gQ2FuY2VsbGVkLCBzZXQgYnkgdGhlIHBvb2wgKHBvb2wgb25seSkuAAAAAAAACnNldF9zdGF0dXMAAAAAAAIAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAKTm90ZVN0YXR1cwAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAIVgMHgwMCDigJYgc2hhMjU2KFNjVmFsOjpBZGRyZXNzIFhEUilbMC4uMzFdYCAoc3BlYyDCpzguNCksIHRoZSBjaXJjdWl0J3MKcHVibGljIGlucHV0IDAuIFZpZXcgaGVscGVyIGZvciB0aGUgVHlwZVNjcmlwdCBwYXJpdHkgdGVzdHMuAAAAAAAAC2FnZW50X2ZpZWxkAAAAAAEAAAAAAAAABGFkZHIAAAATAAAAAQAAA+4AAAAg",
        "AAAAAAAAAPFSZXR1cm5zIHRoZSBhY2NvdW50IGFwcHJvdmVkIGZvciB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAADGdldF9hcHByb3ZlZAAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAPoAAAAEw==",
        "AAAAAQAAAIZUaGUgcHJvb2YgcGFyYW1ldGVycyBmaXhlZCBhdCBkZXBsb3kgdGltZSAocHVibGljIGlucHV0cyA24oCTOCkuIExldHMgYW55b25lCnJlYnVpbGQgYSBub3RlJ3MgcHVibGljIHNpZ25hbHMgZnJvbSBvbi1jaGFpbiBkYXRhIGFsb25lLgAAAAAAAAAAAA5BdHRlc3RlclBhcmFtcwAAAAAAAwAAAAAAAAALYXR0ZXN0ZXJfYXgAAAAD7gAAACAAAAAAAAAAC2F0dGVzdGVyX2F5AAAAA+4AAAAgAAAAAAAAABtudWxsaWZpZXJfc2VjcmV0X2NvbW1pdG1lbnQAAAAD7gAAACA=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAcAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAthdHRlc3Rlcl9heAAAAAPuAAAAIAAAAAAAAAALYXR0ZXN0ZXJfYXkAAAAD7gAAACAAAAAAAAAAG251bGxpZmllcl9zZWNyZXRfY29tbWl0bWVudAAAAAPuAAAAIAAAAAAAAAACdmsAAAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAAIYmFzZV91cmkAAAAQAAAAAA==",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAObnVsbGlmaWVyX3VzZWQAAAAAAAEAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAPYXBwcm92ZV9mb3JfYWxsAAAAAAMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAEpBdHRlc3RlciBwdWJsaWMga2V5IGFuZCBudWxsaWZpZXItc2VjcmV0IGNvbW1pdG1lbnQgKHB1YmxpYyBpbnB1dHMgNuKAkzgpLgAAAAAAD2F0dGVzdGVyX3BhcmFtcwAAAAAAAAAAAQAAB9AAAAAOQXR0ZXN0ZXJQYXJhbXMAAA==",
        "AAAAAAAAAAAAAAAQdmVyaWZpY2F0aW9uX2tleQAAAAAAAAABAAAH0AAAAA9WZXJpZmljYXRpb25LZXkA",
        "AAAABQAAAE1FbWl0dGVkIHdoZW4gdGhlIHBvb2wgc2V0dGxlcyBvciBjYW5jZWxzIGEgbm90ZS4gVG9waWMgYG5vdGVfc3RhdHVzX2NoYW5nZWRgLgAAAAAAAAAAAAARTm90ZVN0YXR1c0NoYW5nZWQAAAAAAAABAAAAE25vdGVfc3RhdHVzX2NoYW5nZWQAAAAAAgAAAAAAAAACaWQAAAAAAAQAAAAAAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAKTm90ZVN0YXR1cwAAAAAAAAAAAAI=",
        "AAAAAAAAANdSZXR1cm5zIHdoZXRoZXIgdGhlIGBvcGVyYXRvcmAgaXMgYWxsb3dlZCB0byBtYW5hZ2UgYWxsIHRoZSBhc3NldHMgb2YKYG93bmVyYC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gQWNjb3VudCBvZiB0aGUgdG9rZW4ncyBvd25lci4KKiBgb3BlcmF0b3JgIC0gQWNjb3VudCB0byBiZSBjaGVja2VkLgAAAAATaXNfYXBwcm92ZWRfZm9yX2FsbAAAAAACAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAAB",
        "AAAAAQAAADhBIHNvdWxib3VuZCBDUENWIE5vdGUgKHNwZWMgwqc3LjIpLiBBbW91bnRzIGFyZSBzdHJvb3BzLgAAAAAAAAAETm90ZQAAAAsAAAAAAAAABWFnZW50AAAAAAAAEwAAABtmbG9vcih0b3RhbF9jb21taXNzaW9uIC8gMikAAAAAEGFnZW50X2NvbW1pc3Npb24AAAALAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAABpEYXlzIHNpbmNlIHRoZSBVbml4IGVwb2NoLgAAAAAADWVzY3JpdHVyYV9kYXkAAAAAAAAEAAAAJXRvdGFsX2NvbW1pc3Npb24g4oiSIGFnZW50X2NvbW1pc3Npb24AAAAAAAAVZXhwbG9yYWRvcl9jb21taXNzaW9uAAAAAAAACwAAAAAAAAACaWQAAAAAAAQAAAAeUHJvdG9jb2wgY2xvY2sgKHVuaXggc2Vjb25kcykuAAAAAAAJbWludGVkX2F0AAAAAAAABgAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAABXByb29mAAAAAAAH0AAAAAxHcm90aDE2UHJvb2YAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApOb3RlU3RhdHVzAAAAAAAAAAAAEHRvdGFsX2NvbW1pc3Npb24AAAAL",
        "AAAAAgAAAAAAAAAAAAAACk5vdGVTdGF0dXMAAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAAJhHcm90aDE2IHByb29mIG92ZXIgQk4yNTQuIGBhYCBpcyBzdG9yZWQgTkVHQVRFRCAo4oiSQSkgc28gdmVyaWZpY2F0aW9uIGlzIGEKc2luZ2xlIHByb2R1Y3Qtb2YtcGFpcmluZ3MgPT0gMSBjaGVjayAoc3BlYyDCpzguNSkuIEcxID0gNjQgYnl0ZXMsIEcyID0gMTI4LgAAAAAAAAAMR3JvdGgxNlByb29mAAAAAwAAAAAAAAABYQAAAAAAA+4AAABAAAAAAAAAAAFiAAAAAAAD7gAAAIAAAAAAAAAAAWMAAAAAAAPuAAAAQA==",
        "AAAAAQAAAERHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXk7IGBpY2AgaGFzIDEwIGVudHJpZXMgKDkgcHVibGljIGlucHV0cyArIDEpLgAAAAAAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAUAAAAAAAAABWFscGhhAAAAAAAD7gAAAEAAAAAAAAAABGJldGEAAAPuAAAAgAAAAAAAAAAFZGVsdGEAAAAAAAPuAAAAgAAAAAAAAAAFZ2FtbWEAAAAAAAPuAAAAgAAAAAAAAAACaWMAAAAAA+oAAAPuAAAAQA==",
        "AAAABAAAAIdTaGFyZWQgZXJyb3IgbnVtYmVyaW5nIGZvciBhbGwgZXhwbG9yYWRvciBhZHZhbmNlIGNvbnRyYWN0cyAoc3BlYyDCpzcuMykuCkFwcGVuZCBuZXcgdmFyaWFudHMgYXQgdGhlIGVuZDsgbmV2ZXIgcmVudW1iZXIgZXhpc3Rpbmcgb25lcy4AAAAAAAAAAAVFcnJvcgAAAAAAABYAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAABAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAADAAAAAAAAABJJbnN1ZmZpY2llbnRDcmVkaXQAAAAAAAQAAAAAAAAAFUluc3VmZmljaWVudExpcXVpZGl0eQAAAAAAAAUAAAAAAAAAE0xldmVyYWdlQ2FwRXhjZWVkZWQAAAAABgAAAAAAAAAOQ2FyZE5vdEVuYWJsZWQAAAAAAAcAAAAAAAAADEFnZW50QmxvY2tlZAAAAAgAAAAAAAAADUxpbmVOb3RBY3RpdmUAAAAAAAAJAAAAAAAAAAxHcmFjZU5vdE92ZXIAAAAKAAAAAAAAABFOb3RoaW5nVG9Xcml0ZU9mZgAAAAAAAAsAAAAAAAAADUR1cGxpY2F0ZURyYXcAAAAAAAAMAAAAAAAAAAxJbnZhbGlkUHJvb2YAAAANAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAADgAAAAAAAAAOQ29tbWl0bWVudFVzZWQAAAAAAA8AAAAAAAAAD0VzY3JpdHVyYUluUGFzdAAAAAAQAAAAAAAAAAlTb3VsYm91bmQAAAAAAAARAAAAAAAAAAtVbmtub3duTm90ZQAAAAASAAAAOWBhZHZhbmNlX2Nsb2NrYCBjYWxsZWQgd2hpbGUgYHBhcmFtcy5kZW1vX21vZGVgIGlzIGZhbHNlLgAAAAAAABBEZW1vTW9kZURpc2FibGVkAAAAEwAAAC9gYWR2YW5jZV9jbG9ja2AgYWJvdmUgdGhlIDQwMC1kYXkgcGVyLWNhbGwgY2FwLgAAAAAUQ2xvY2tBZHZhbmNlVG9vTGFyZ2UAAAAUAAAAHkNoZWNrZWQgYXJpdGhtZXRpYyBvdmVyZmxvd2VkLgAAAAAACE92ZXJmbG93AAAAFQAAACRgY3Bjdl9ub3RlLnNldF9wb29sYCBub3QgY2FsbGVkIHlldC4AAAAKUG9vbE5vdFNldAAAAAAAFg==",
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
        count: this.txFromJSON<u32>,
        symbol: this.txFromJSON<string>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<u32>,
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
        attester_params: this.txFromJSON<AttesterParams>,
        verification_key: this.txFromJSON<VerificationKey>,
        is_approved_for_all: this.txFromJSON<boolean>
  }
}