// Turns errors from the Stellar service into the API's `{ error: { code,
// message } }` responses with a message an admin can act on. lib/stellar
// already throws typed HttpErrors (ContractError with `contractCode`, TxError
// with `txHash`, RpcError, NotDeployedError, …): contract errors get the
// admin wording below (reworded per action where it helps), everything else
// passes through. Untyped errors are matched by number ("Error(Contract,
// #10)", "contract error #10") or by name, following
// contracts/shared/src/errors.rs.

import { HttpError } from "@/lib/http";

interface ContractErrorInfo {
  name: string;
  status: number;
  message: string;
}

/** Shared error numbering of the three contracts (contracts/shared/src/errors.rs); statuses as in lib/stellar/errors. */
export const CONTRACT_ERRORS: Record<number, ContractErrorInfo> = {
  1: { name: "NotAuthorized", status: 403, message: "The contract rejected the signer (check the operator/treasury/admin keys of this deployment)" },
  2: { name: "AlreadyInitialized", status: 409, message: "Already initialized" },
  3: { name: "InvalidAmount", status: 400, message: "The amount is not allowed (zero, or more than is available)" },
  4: { name: "InsufficientCredit", status: 409, message: "Not enough credit available" },
  5: { name: "InsufficientLiquidity", status: 409, message: "Not enough idle liquidity in the pool" },
  6: { name: "LeverageCapExceeded", status: 409, message: "This would push outstanding debt above 10× the junior tranche" },
  7: { name: "CardNotEnabled", status: 409, message: "The agent has not enabled the card on-chain" },
  8: { name: "AgentBlocked", status: 409, message: "The agent is blocked" },
  9: { name: "LineNotActive", status: 409, message: "The note's credit line is no longer active" },
  10: { name: "GraceNotOver", status: 409, message: "The grace period has not ended yet" },
  11: { name: "NothingToWriteOff", status: 409, message: "The agent has no carried debt to write off" },
  12: { name: "DuplicateDraw", status: 409, message: "This card draw was already recorded" },
  13: { name: "InvalidProof", status: 400, message: "The note contract rejected the zero-knowledge proof" },
  14: { name: "NullifierUsed", status: 409, message: "This CPCV was already financed (its nullifier is used)" },
  15: { name: "CommitmentUsed", status: 409, message: "This commitment was already used" },
  16: { name: "EscrituraInPast", status: 400, message: "The escritura date is not after the protocol date" },
  17: { name: "Soulbound", status: 409, message: "CPCV Notes are soulbound" },
  18: { name: "UnknownNote", status: 404, message: "The note does not exist on-chain" },
  19: { name: "DemoModeDisabled", status: 409, message: "This deployment is not in demo mode, so its clock can't be moved" },
  20: { name: "ClockAdvanceTooLarge", status: 400, message: "The clock can move at most 400 days per call" },
  21: { name: "Overflow", status: 400, message: "Arithmetic overflow in the contract" },
  22: { name: "PoolNotSet", status: 409, message: "cpcv_note is not wired to advance_pool yet (set_pool)" },
};

const NAME_TO_CODE = new Map(Object.entries(CONTRACT_ERRORS).map(([code, info]) => [info.name, Number(code)]));
const NAME_PATTERN = new RegExp(`\\b(${[...NAME_TO_CODE.keys()].join("|")})\\b`);

/** Message of an error and its causes, joined. */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : undefined;
  }
  return parts.filter(Boolean).join(": ");
}

/** The contract error number in an error (or its causes), if any. */
export function contractErrorCode(err: unknown): number | null {
  const typed = (err as { contractCode?: unknown } | null)?.contractCode;
  if (typeof typed === "number") return typed;
  const text = errorText(err);
  const numbered = /Error\(Contract,\s*#(\d+)\)|contract error #(\d+)/i.exec(text);
  if (numbered) return Number(numbered[1] ?? numbered[2]);
  const named = NAME_PATTERN.exec(text);
  return named ? (NAME_TO_CODE.get(named[1]) ?? null) : null;
}

/** The hash of a transaction that was sent but failed (lib/stellar TxError / on-chain ContractError). */
export function failedTxHash(err: unknown): string | null {
  const hash = (err as { txHash?: unknown } | null)?.txHash;
  return typeof hash === "string" && hash !== "" ? hash : null;
}

/** First line of a long RPC/XDR error, capped, for UI messages. */
export function shortMessage(err: unknown, max = 300): string {
  const text = errorText(err).split("\n")[0].trim() || "Unknown error";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * HttpError for a failed chain call. Contract errors get an admin-readable
 * message (`overrides` rewords specific codes for the action at hand), keeping
 * the status lib/stellar chose; other HttpErrors (RPC down, not deployed, a
 * stub's 501) pass through; anything else is a 502 CHAIN_ERROR. A transaction
 * that was sent and failed is named, so it can be looked up.
 */
export function chainHttpError(err: unknown, overrides: Partial<Record<number, string>> = {}): HttpError {
  const code = contractErrorCode(err);
  const tx = failedTxHash(err);
  const withTx = (message: string) => (tx && !message.includes(tx) ? `${message} (transaction ${tx})` : message);
  if (code !== null && CONTRACT_ERRORS[code]) {
    const info = CONTRACT_ERRORS[code];
    const status = err instanceof HttpError ? err.status : info.status;
    return new HttpError(status, upperSnake(info.name), withTx(overrides[code] ?? info.message));
  }
  if (err instanceof HttpError) return tx ? new HttpError(err.status, err.code, withTx(err.message)) : err;
  return new HttpError(502, "CHAIN_ERROR", withTx(`Stellar call failed: ${shortMessage(err)}`));
}

const upperSnake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
