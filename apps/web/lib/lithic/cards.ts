// Agent cards (spec §4.2 step 3, §9.4): a Lithic sandbox virtual card on the
// Visa test program, or a simulated card while LITHIC_API_KEY is unset. The
// card token is how ASA requests identify the agent (Agent.lithicCardToken).

import { createHash } from "node:crypto";

import { issueSimulatedCard, isSimulatedToken, simulatedCardDetails } from "@/lib/card/simulated-network";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { CardRevealResponse } from "@/lib/types/api";

import { getLithic, lithicEnabled, SANDBOX_VISA_PROGRAM } from "./client";
import { createSpacer } from "./rate-limit";

export interface AgentCard {
  token: string;
  last4: string;
}

// Sandbox `cards` resource: 2 writes per second.
const cardWrites = createSpacer(550);

/** Deterministic UUID-shaped idempotency key (Lithic requires a UUID; keys live 30 days), so a retry returns the same card. */
export function cardIdempotencyKey(agentUserId: string): string {
  const h = createHash("sha256").update(`explorador-advance:agent-card:${agentUserId}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40; // version 4 layout
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function issueLithicCard(agentUserId: string): Promise<AgentCard> {
  const card = await cardWrites(() =>
    getLithic().cards.create({
      type: "VIRTUAL",
      memo: agentUserId,
      card_program_token: SANDBOX_VISA_PROGRAM,
      "Idempotency-Key": cardIdempotencyKey(agentUserId),
    }),
  );
  return { token: card.token, last4: card.last_four };
}

/**
 * Creates the agent's sandbox virtual card (or a simulated card when LITHIC_API_KEY is unset).
 * Idempotent: returns the card already on the Agent row, if any (a simulated card is replaced
 * by a Lithic one once a key is configured). When the Agent row exists the card is stored on it;
 * otherwise the caller stores `token` → Agent.lithicCardToken and `last4` → Agent.cardLast4.
 */
export async function createAgentCard(agentUserId: string): Promise<AgentCard> {
  const agent = await db.agent.findUnique({
    where: { userId: agentUserId },
    select: { lithicCardToken: true, cardLast4: true },
  });
  const useLithic = lithicEnabled();
  if (agent?.lithicCardToken && agent.cardLast4 && !(useLithic && isSimulatedToken(agent.lithicCardToken))) {
    return { token: agent.lithicCardToken, last4: agent.cardLast4 };
  }

  const card = useLithic ? await issueLithicCard(agentUserId) : issueSimulatedCard();
  if (agent) {
    await db.agent.update({ where: { userId: agentUserId }, data: { lithicCardToken: card.token, cardLast4: card.last4 } });
  }
  return card;
}

/** PAN, CVV and expiry for "Reveal details" (Lithic returns PCI fields to every sandbox client). */
export async function revealCard(card: AgentCard): Promise<CardRevealResponse> {
  if (isSimulatedToken(card.token) || !lithicEnabled()) return simulatedCardDetails(card.last4);
  const details = await getLithic().cards.retrieve(card.token);
  if (!details.pan || !details.cvv || !details.exp_month || !details.exp_year) {
    throw new HttpError(502, "LITHIC_CARD_DETAILS", "Lithic did not return the card details");
  }
  return { pan: details.pan, cvv: details.cvv, expMonth: details.exp_month, expYear: details.exp_year };
}

/** The card number, needed by `simulate/authorize`. */
export async function cardPan(cardToken: string): Promise<string> {
  const { pan } = await getLithic().cards.retrieve(cardToken);
  if (!pan) throw new HttpError(502, "LITHIC_CARD_DETAILS", "Lithic did not return the card number");
  return pan;
}
