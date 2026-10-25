// Investor-facing errors for the Freighter + Soroban flows. Every failure is
// normalized to a WalletError whose `message` can be shown as is; `code`
// drives UI decisions (e.g. offering "Get test XLM" for ACCOUNT_NOT_FUNDED).

export type WalletErrorCode =
  | "FREIGHTER_NOT_INSTALLED"
  | "USER_DECLINED"
  | "WALLET_ERROR"
  | "WRONG_NETWORK"
  | "ACCOUNT_NOT_FUNDED"
  | "CONTRACT_ERROR"
  | "CONTRACT_MISSING"
  | "SIMULATION_FAILED"
  | "TX_REJECTED"
  | "TX_FAILED"
  | "TX_TIMEOUT"
  | "NETWORK";

export interface WalletErrorDetails {
  /** `Error(Contract, #n)` code, when a contract rejected the call. */
  contractCode?: number;
  /** Transaction or operation result code, e.g. "txTooLate", "invokeHostFunctionTrapped". */
  resultCode?: string;
  /** Set once the transaction was submitted. */
  txHash?: string;
  cause?: unknown;
}

export class WalletError extends Error {
  readonly code: WalletErrorCode;
  readonly contractCode?: number;
  readonly resultCode?: string;
  readonly txHash?: string;

  constructor(code: WalletErrorCode, message: string, details: WalletErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "WalletError";
    this.code = code;
    this.contractCode = details.contractCode;
    this.resultCode = details.resultCode;
    this.txHash = details.txHash;
  }
}

/**
 * Contract errors an investor can hit, with plain-language messages. Shared
 * numbering from contracts/shared/src/errors.rs; 100+ are OpenZeppelin
 * stellar-tokens fungible errors (tEURC and the eaSR share token).
 */
const CONTRACT_ERRORS: Record<number, { name: string; message: string }> = {
  1: { name: "NotAuthorized", message: "This account isn't allowed to do that." },
  3: { name: "InvalidAmount", message: "That amount isn't valid here: it may round to zero, or be more than your position." },
  5: {
    name: "InsufficientLiquidity",
    message: "Not enough idle liquidity in the pool right now. Try a smaller amount: more frees up as agents repay.",
  },
  6: { name: "LeverageCapExceeded", message: "The pool is at its leverage cap." },
  21: { name: "Overflow", message: "That amount is too large." },
  100: { name: "InsufficientBalance", message: "Your token balance is too low for this amount." },
  101: { name: "InsufficientAllowance", message: "The token allowance is too low for this amount." },
  103: { name: "LessThanZero", message: "Amounts can't be negative." },
  104: { name: "MathOverflow", message: "That amount is too large." },
};

/** Name and investor-facing message for a contract error code. */
export function describeContractError(code: number): { name: string; message: string } {
  return CONTRACT_ERRORS[code] ?? { name: `ContractError${code}`, message: `The contract rejected the transaction (error #${code}).` };
}

export const contractError = (code: number, details: Omit<WalletErrorDetails, "contractCode"> = {}): WalletError =>
  new WalletError("CONTRACT_ERROR", describeContractError(code).message, { ...details, contractCode: code });

/** Messages for transaction result codes from `sendTransaction` / `getTransaction`. */
const RESULT_MESSAGES: Record<string, string> = {
  txTooLate: "The transaction expired before it reached the network. Please try again.",
  txTooEarly: "The transaction isn't valid yet. Please try again.",
  txBadSeq: "Your account's sequence number changed (another transaction?). Please try again.",
  txInsufficientBalance: "Not enough XLM to pay the network fee. Use “Get test XLM” first.",
  txInsufficientFee: "The network is busy and the fee was too low. Please try again.",
  txNoAccount: "Your account isn't on testnet yet. Use “Get test XLM” first.",
  txBadAuth: "The signature didn't match this account. Check the account selected in Freighter.",
  invokeHostFunctionResourceLimitExceeded: "The transaction ran out of resources. Please try again.",
  invokeHostFunctionInsufficientRefundableFee: "The transaction fee was too low. Please try again.",
  invokeHostFunctionEntryArchived: "Some contract data is archived on testnet. Please try again later.",
};

export const resultCodeMessage = (code: string | undefined, fallback: string): string =>
  (code && RESULT_MESSAGES[code]) || fallback;

const firstLine = (s: string) => s.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";

/**
 * Turns an RPC simulation error string into a WalletError. Formats seen on
 * testnet:
 *   "HostError: Error(Contract, #5)\n\nEvent log (newest first): …"
 *   "HostError: Error(Storage, MissingValue)\n\nEvent log … non-existing value for contract instance"
 */
export function parseSimulationError(raw: string): WalletError {
  const contract = /Error\(Contract, #(\d+)\)/.exec(raw);
  if (contract) return contractError(Number(contract[1]));
  if (/Error\(Storage, MissingValue\)/.test(raw) && /contract instance|contract code/i.test(raw)) {
    return new WalletError(
      "CONTRACT_MISSING",
      "The pool's contracts aren't on testnet anymore (testnet may have been reset). The explorador team needs to redeploy them.",
    );
  }
  const host = /Error\((\w+), (\w+)\)/.exec(raw);
  const what = host ? `Error(${host[1]}, ${host[2]})` : firstLine(raw) || "unknown error";
  return new WalletError("SIMULATION_FAILED", `The transaction can't go through right now (${what}).`);
}

/** Freighter's `{ code, message }` errors (code −4 = the user rejected the request). */
export function freighterError(error: { code?: number; message?: string } | string | undefined, action: string): WalletError {
  const code = typeof error === "object" ? error.code : undefined;
  const message = typeof error === "object" ? error.message : error;
  if (code === -4 || /reject|declin|denied|cancel/i.test(message ?? "")) {
    return new WalletError("USER_DECLINED", `You rejected the request in Freighter.`);
  }
  return new WalletError("WALLET_ERROR", `Freighter couldn't ${action}${message ? `: ${message}` : "."}`);
}

const NETWORK_FAILURE = /failed to fetch|fetch failed|networkerror|network error|load failed|ECONNREFUSED|ETIMEDOUT|timeout of \d+ms/i;

/** Normalizes anything thrown during a wallet flow. */
export function toWalletError(err: unknown, fallback = "Something went wrong. Please try again."): WalletError {
  if (err instanceof WalletError) return err;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (NETWORK_FAILURE.test(message)) {
    return new WalletError("NETWORK", "Can't reach the Stellar network right now. Check your connection and try again.", { cause: err });
  }
  return new WalletError("WALLET_ERROR", message ? `${fallback} (${message})` : fallback, { cause: err });
}
