import { requireAgent } from "@/lib/auth/session";
import { parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { agentTxActionSchema, prepareAgentTx } from "@/lib/stellar/agent-tx";

export const maxDuration = 30;

// Spec §9.3: build the advance_pool call (sponsor as source), simulate, return the digests to sign.
export const POST = route(async (req: Request) => {
  const user = await requireAgent();
  const action = await parseBody(req, agentTxActionSchema);
  return jsonResponse(await prepareAgentTx(user, action));
});
