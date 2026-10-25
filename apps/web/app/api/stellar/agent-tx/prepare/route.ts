import { z } from "zod";
import { prepareAgentTx } from "@/lib/agent";
import { requireAgent } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";

const Body = z.object({
  action: z.enum(["enable_card", "disable_card", "withdraw_balance"]),
  amount: z.string().regex(/^\d{1,30}$/).optional(),
  to: z.string().trim().optional(),
});

export const POST = handle(async (req: Request) => {
  const { userId } = await requireAgent();
  const { action, amount, to } = await parseBody(req, Body);
  const agent = await db.agent.findUnique({ where: { userId } });
  if (!agent) throw new HttpError(409, "NOT_ONBOARDED", "Finish onboarding first");
  return json(await prepareAgentTx(agent, action, { amount, to }));
});
