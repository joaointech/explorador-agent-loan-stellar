import { requireAgent } from "@/lib/auth/session";
import { parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { agentTxSubmitSchema, submitAgentTx } from "@/lib/stellar/agent-tx";

export const maxDuration = 60;

// Spec §9.3: attach the passkey signature, re-simulate, sign as sponsor, submit and wait.
export const POST = route(async (req: Request) => {
  const user = await requireAgent();
  const body = await parseBody(req, agentTxSubmitSchema);
  return jsonResponse(await submitAgentTx(user, body));
});
