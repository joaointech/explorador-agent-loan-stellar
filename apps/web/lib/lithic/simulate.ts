// Lithic sandbox `POST /v1/simulate/authorize` (spec §4.4 step 1). Lithic runs
// the authorization through the enrolled ASA responder before answering, so
// when this resolves our CardAuthorization row normally exists already.

import type Lithic from "lithic";

import { getLithic } from "./client";
import { createSpacer } from "./rate-limit";

// Sandbox simulations: 1 write per second. Queue briefly, then refuse (429).
const simulationWrites = createSpacer(1_100, { maxWaitMs: 4_000 });

export interface SimulateAuthorizationInput {
  pan: string;
  /** Cents; sandbox bills in USD by default and the app treats it as EUR 1:1. */
  amountCents: bigint;
  /** Merchant descriptor shown on the transaction. */
  descriptor: string;
}

/**
 * Sandbox `POST /v1/simulate/clearing`: the merchant captures an approved
 * authorization, which moves the Lithic transaction from PENDING to SETTLED.
 * Clears the authorized amount (clearing adjustments are out of scope, spec §13).
 */
export function simulateClearing(token: string): Promise<Lithic.TransactionSimulateClearingResponse> {
  return simulationWrites(() => getLithic().transactions.simulateClearing({ token }));
}

/** Resolves to `{ token }`: the Lithic transaction token our ASA handler records. */
export function simulateAuthorization(input: SimulateAuthorizationInput): Promise<Lithic.TransactionSimulateAuthorizationResponse> {
  return simulationWrites(() =>
    getLithic().transactions.simulateAuthorization({
      amount: Number(input.amountCents),
      descriptor: input.descriptor,
      pan: input.pan,
    }),
  );
}
