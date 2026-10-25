// POST /api/agent/card/simulate {amountEur, merchant} (agent): a card purchase
// through Lithic sandbox, or through the built-in simulated card network when
// LITHIC_API_KEY is unset. Responds with the ASA decision; the UI then polls
// /api/agent/card/authorizations/[id] for the on-chain draw.

import { after } from "next/server";

import { requireAgent } from "@/lib/auth/session";
import { simulatePurchase, simulateRequestSchema } from "@/lib/card/simulate";
import { parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { SimulateResponse } from "@/lib/types/api";

// Lithic's simulate call waits for our ASA responder; the simulated network draws in after().
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  const user = await requireAgent();
  const body = await parseBody(req, simulateRequestSchema);
  const { response, followUp } = await simulatePurchase(user.userId, body);
  if (followUp) after(followUp);
  return jsonResponse<SimulateResponse>(response);
});
