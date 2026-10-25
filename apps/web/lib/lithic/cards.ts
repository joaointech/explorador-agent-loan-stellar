// Interface owned by the Card (Lithic) workstream (spec §9.4). The
// implementation replaces the stub body.

import { notImplemented } from "@/lib/http";

export interface AgentCard {
  token: string;
  last4: string;
}

/** Creates the agent's sandbox virtual card (or a simulated card when LITHIC_API_KEY is unset). */
export async function createAgentCard(_agentUserId: string): Promise<AgentCard> {
  notImplemented("createAgentCard", "card (lithic)");
}
