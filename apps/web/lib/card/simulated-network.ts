// Built-in simulated card network, used while LITHIC_API_KEY is unset (and for
// cards issued without it). It stands in for Lithic's side only: it issues
// cards, and builds ASA requests shaped exactly like Lithic's (type-checked
// against the SDK's webhook event) that the caller runs through the same
// pipeline as `POST /api/lithic/asa`. Card tokens (`sim_card_…`) and
// transaction tokens (`sim_txn_…`) start with `sim_`.

import { randomInt, randomUUID } from "node:crypto";

import type Lithic from "lithic";

import type { CardRevealResponse } from "@/lib/types/api";

export const SIMULATED_PREFIX = "sim_";

export const isSimulatedToken = (token: string) => token.startsWith(SIMULATED_PREFIX);

export function issueSimulatedCard(): { token: string; last4: string } {
  return { token: `${SIMULATED_PREFIX}card_${randomUUID()}`, last4: String(randomInt(0, 10_000)).padStart(4, "0") };
}

/** Obviously fake test details; the PAN ends in the card's last4 so it matches the card visual. */
export function simulatedCardDetails(last4: string): CardRevealResponse {
  return { pan: `400000000000${last4}`, cvv: "000", expMonth: "12", expYear: String(new Date().getUTCFullYear() + 3) };
}

export interface SimulatedAuthorizationInput {
  cardToken: string;
  last4: string;
  memo?: string;
  /** Cents; for credits Lithic sends negative amounts. */
  amountCents: bigint;
  merchant: string;
  status?: Lithic.CardAuthorization["status"];
  /** Transaction token; a fresh `sim_txn_…` by default. */
  token?: string;
  now?: Date;
}

/** An ASA request as Lithic sandbox would send it: USD cents (treated as EUR 1:1), Visa, card not present. */
export function buildSimulatedAsaRequest(input: SimulatedAuthorizationInput): Lithic.CardAuthorizationApprovalRequestWebhookEvent {
  const amount = Number(input.amountCents);
  return {
    event_type: "card_authorization.approval_request",
    token: input.token ?? `${SIMULATED_PREFIX}txn_${randomUUID()}`,
    status: input.status ?? "AUTHORIZATION",
    created: (input.now ?? new Date()).toISOString(),
    acquirer_fee: 0,
    amount,
    authorization_amount: amount,
    merchant_amount: amount,
    settled_amount: 0,
    cash_amount: 0,
    cardholder_currency: "USD",
    merchant_currency: "USD",
    amounts: {
      cardholder: { amount, conversion_rate: "1.000000", currency: "USD" },
      merchant: { amount, currency: "USD" },
      hold: null,
      settlement: null,
    },
    avs: { address: "", zipcode: "", address_on_file_match: "NOT_PRESENT" },
    card: {
      token: input.cardToken,
      last_four: input.last4,
      memo: input.memo ?? "",
      spend_limit: 0,
      spend_limit_duration: "TRANSACTION",
      state: "OPEN",
      tags: {},
      type: "VIRTUAL",
    },
    merchant: {
      acceptor_id: "SIMULATED",
      acquiring_institution_id: "000000",
      descriptor: input.merchant,
      mcc: "5999",
      city: "LISBOA",
      state: "",
      country: "PRT",
      phone_number: null,
      postal_code: null,
      street_address: null,
    },
    network: "VISA",
    name_validation: null,
    service_location: null,
    transaction_initiator: "CARDHOLDER",
  };
}
