// Typed errors for the Stellar service. They extend HttpError so a route
// wrapped in `route()` turns them into `{ error: { code, message } }` with a
// meaningful status (e.g. settling before the grace period → 409
// GRACE_NOT_OVER) without any per-route mapping.

import { HttpError } from "@/lib/http";

/** Shared contract error numbering (contracts/shared/src/errors.rs). */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: "NotAuthorized",
  2: "AlreadyInitialized",
  3: "InvalidAmount",
  4: "InsufficientCredit",
  5: "InsufficientLiquidity",
  6: "LeverageCapExceeded",
  7: "CardNotEnabled",
  8: "AgentBlocked",
  9: "LineNotActive",
  10: "GraceNotOver",
  11: "NothingToWriteOff",
  12: "DuplicateDraw",
  13: "InvalidProof",
  14: "NullifierUsed",
  15: "CommitmentUsed",
  16: "EscrituraInPast",
  17: "Soulbound",
  18: "UnknownNote",
  19: "DemoModeDisabled",
  20: "ClockAdvanceTooLarge",
  21: "Overflow",
  22: "PoolNotSet",
  // OpenZeppelin stellar-tokens 0.8.0 (teurc, eaSR share token, note NFT)
  100: "InsufficientBalance",
  101: "InsufficientAllowance",
  102: "InvalidLiveUntilLedger",
  103: "LessThanZero",
  104: "MathOverflow",
  200: "NonExistentToken",
  201: "IncorrectOwner",
  202: "InsufficientApproval",
  400: "VaultAssetAddressNotSet",
  403: "VaultInvalidAssetsAmount",
  404: "VaultInvalidSharesAmount",
  405: "VaultExceededMaxDeposit",
  406: "VaultExceededMaxMint",
  407: "VaultExceededMaxWithdraw",
  408: "VaultExceededMaxRedeem",
  411: "VaultZeroShares",
  412: "VaultZeroAssets",
};

const STATUS_BY_ERROR: Record<string, number> = {
  UnknownNote: 404,
  NonExistentToken: 404,
  NotAuthorized: 403,
  InvalidAmount: 400,
  InvalidProof: 400,
  EscrituraInPast: 400,
  ClockAdvanceTooLarge: 400,
  Overflow: 400,
  LessThanZero: 400,
  VaultInvalidAssetsAmount: 400,
  VaultInvalidSharesAmount: 400,
};

/** "GraceNotOver" → "GRACE_NOT_OVER". */
export const toScreamingSnake = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();

/** A contract returned `Error(Contract, #code)` (simulation or on-chain). */
export class ContractError extends HttpError {
  readonly errorName: string;
  constructor(
    readonly contractCode: number,
    readonly fn: string,
    readonly detail?: string,
    /** Set when the error comes from a transaction that failed on-chain (not from simulation). */
    readonly txHash?: string,
  ) {
    const errorName = CONTRACT_ERRORS[contractCode] ?? `ContractError${contractCode}`;
    super(
      STATUS_BY_ERROR[errorName] ?? 409,
      toScreamingSnake(errorName),
      `${fn}: ${errorName} (contract error #${contractCode})${detail ? `: ${detail}` : ""}`,
    );
    this.errorName = errorName;
  }
}

/** The host failed outside the contract's own errors (budget, storage, auth, …). */
export class HostError extends HttpError {
  constructor(
    readonly fn: string,
    readonly hostError: string,
    raw: string,
  ) {
    super(502, "HOST_ERROR", `${fn}: ${hostError}${raw ? ` (${firstLine(raw)})` : ""}`);
  }
}

/** The contract id from the deployment has no instance on-chain (e.g. testnet was reset). */
export class ContractMissingError extends HttpError {
  constructor(readonly contractId: string) {
    super(503, "CONTRACT_MISSING", `Contract ${contractId} is not on the network (testnet reset?). Run pnpm demo:reset.`);
  }
}

export class NotDeployedError extends HttpError {
  constructor() {
    super(503, "NOT_DEPLOYED", "Contracts are not deployed yet: run pnpm deploy:testnet (deployments/testnet.json or an active Deployment row).");
  }
}

export class NotConfiguredError extends HttpError {
  constructor(message: string) {
    super(503, "NOT_CONFIGURED", message);
  }
}

export class RpcError extends HttpError {
  constructor(message: string) {
    super(502, "RPC_UNAVAILABLE", message);
  }
}

export class RpcTimeoutError extends HttpError {
  constructor(
    readonly what: string,
    readonly timeoutMs: number,
  ) {
    super(504, "RPC_TIMEOUT", `${what} timed out after ${timeoutMs} ms`);
  }
}

/** A submitted transaction failed or could not be confirmed. `txHash` is set once it was sent. */
export class TxError extends HttpError {
  constructor(
    code: "TX_FAILED" | "TX_REJECTED" | "TX_TIMEOUT",
    message: string,
    readonly txHash: string | null,
    readonly resultCode?: string,
  ) {
    super(code === "TX_TIMEOUT" ? 504 : 502, code, message);
  }
}

/** A Soroban auth entry needs a signature from an address we hold no key for. */
export class MissingSignerError extends HttpError {
  constructor(
    readonly address: string,
    fn: string,
  ) {
    super(500, "MISSING_SIGNER", `${fn} needs an authorization from ${address}, but no signer for it was provided`);
  }
}

/** A value returned by a contract doesn't have the expected shape. */
export class DecodeError extends HttpError {
  constructor(message: string) {
    super(502, "DECODE_ERROR", message);
  }
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";

/**
 * Turns a simulation / host error string into a typed error. Formats seen on
 * testnet (RPC 30, protocol 29):
 *   "HostError: Error(Contract, #8)\n\nEvent log (newest first): …"
 *   "HostError: Error(Storage, MissingValue)\n\nEvent log … non-existing value for contract instance"
 */
export function parseHostError(raw: string, fn: string, contractId?: string): HttpError {
  const contract = /Error\(Contract, #(\d+)\)/.exec(raw);
  if (contract) {
    const detail = /data:\["([^"]+)"/.exec(raw)?.[1];
    return new ContractError(Number(contract[1]), fn, detail);
  }
  if (/Error\(Storage, MissingValue\)/.test(raw) && /contract instance|contract code/i.test(raw) && contractId) {
    return new ContractMissingError(contractId);
  }
  const host = /Error\((\w+), (\w+)\)/.exec(raw);
  return new HostError(fn, host ? `Error(${host[1]}, ${host[2]})` : firstLine(raw) || "simulation failed", raw);
}

/** True when `err` is a contract error with this name (e.g. "DuplicateDraw"). */
export const isContractError = (err: unknown, name?: string): err is ContractError =>
  err instanceof ContractError && (name === undefined || err.errorName === name);
