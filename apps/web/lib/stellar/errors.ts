// Decodes `Error(Contract, #N)` diagnostics into the shared contract error names (§7.3).

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
  19: "MathOverflow",
  20: "DemoModeDisabled",
  21: "InvalidParams",
  22: "ClockAdvanceTooLarge",
  23: "FaucetLimitExceeded",
  24: "InsufficientBalance",
  25: "ExceedsMaximum",
  26: "PoolNotSet",
  27: "NonCanonicalField",
  // OpenZeppelin fungible errors
  100: "InsufficientBalance",
  101: "InsufficientAllowance",
};

export class ContractCallError extends Error {
  constructor(
    message: string,
    public code: string,
    public contractCode: number | null,
  ) {
    super(message);
    this.name = "ContractCallError";
  }
}

export function decodeContractError(raw: string): ContractCallError {
  const m = raw.match(/Error\(Contract, #(\d+)\)/);
  if (m) {
    const n = Number(m[1]);
    const name = CONTRACT_ERRORS[n] ?? `ContractError${n}`;
    return new ContractCallError(`${name} (contract error #${n})`, name, n);
  }
  if (/Error\(Auth, /.test(raw)) return new ContractCallError("Authorization failed", "AuthFailed", null);
  if (/Error\(Budget, /.test(raw)) return new ContractCallError("Transaction exceeded the network resource budget", "Budget", null);
  const short = raw.split("\n")[0].slice(0, 300);
  return new ContractCallError(short, "ChainError", null);
}
