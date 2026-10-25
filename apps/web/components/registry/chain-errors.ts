// Outcomes of reading a note from Stellar, kept apart from the RPC code so the
// proof check can classify them without loading the Stellar SDK.

/** We couldn't ask Stellar (no deployment info, network or RPC failure): the check falls back to the registry's copy. */
export class ChainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainUnavailableError";
  }
}

/** Stellar answered, and the answer is a failure or malformed (e.g. no such note): the check fails. */
export class ChainRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainRejectedError";
  }
}
