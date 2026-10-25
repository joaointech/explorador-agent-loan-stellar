// The signed-in agent's card, for the agent API routes.

import { db } from "@/lib/db";
import { conflict } from "@/lib/http";
import { revealCard } from "@/lib/lithic/cards";
import type { CardRevealResponse } from "@/lib/types/api";

export interface AgentWithCard {
  userId: string;
  cardToken: string;
  last4: string;
}

/** Throws 409 while onboarding hasn't produced an agent account or a card yet. */
export async function requireAgentCard(userId: string): Promise<AgentWithCard> {
  const agent = await db.agent.findUnique({ where: { userId }, select: { userId: true, lithicCardToken: true, cardLast4: true } });
  if (!agent) throw conflict("Finish onboarding first: your agent account isn't set up yet", "AGENT_NOT_READY");
  if (!agent.lithicCardToken || !agent.cardLast4) throw conflict("Your card hasn't been issued yet", "NO_CARD");
  return { userId: agent.userId, cardToken: agent.lithicCardToken, last4: agent.cardLast4 };
}

export async function revealAgentCard(userId: string): Promise<CardRevealResponse> {
  const card = await requireAgentCard(userId);
  return revealCard({ token: card.cardToken, last4: card.last4 });
}
