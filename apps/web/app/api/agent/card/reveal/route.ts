// GET /api/agent/card/reveal (agent, sandbox only): PAN, CVV and expiry for
// the "Reveal details" button. Simulated cards return obviously fake details.

import { requireAgent } from "@/lib/auth/session";
import { revealAgentCard } from "@/lib/card/agent-card";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { CardRevealResponse } from "@/lib/types/api";

export const GET = route(async () => {
  const user = await requireAgent();
  return jsonResponse<CardRevealResponse>(await revealAgentCard(user.userId), {
    headers: { "Cache-Control": "no-store, private" },
  });
});
