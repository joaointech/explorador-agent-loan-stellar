import { provisionAgent } from "@/lib/agent/provision";
import { requireAgent } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { AgentProvisioning } from "@/lib/types/api";

export const maxDuration = 60;

// Retries (or reports) the agent's smart account + card set-up; idempotent.
export const POST = route(async () => {
  const user = await requireAgent();
  return jsonResponse<AgentProvisioning>(await provisionAgent(user.userId));
});
