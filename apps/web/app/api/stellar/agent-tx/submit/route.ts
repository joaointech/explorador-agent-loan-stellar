import { z } from "zod";
import type { TxSubmitResponse } from "@/lib/api-types";
import { submitAgentTx } from "@/lib/agent";
import { requireAgent } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { refreshCachedPosition } from "@/lib/lithic/asa";
import { ContractCallError } from "@/lib/stellar/errors";

export const maxDuration = 60;

const Body = z.object({
  xdr: z.string().min(10).max(200_000),
  action: z.enum(["enable_card", "disable_card", "withdraw_balance"]),
});

export const POST = handle(async (req: Request) => {
  const { userId } = await requireAgent();
  const { xdr, action } = await parseBody(req, Body);
  const agent = await db.agent.findUnique({ where: { userId } });
  if (!agent) throw new HttpError(409, "NOT_ONBOARDED", "Finish onboarding first");
  try {
    const r = await submitAgentTx(agent, action, xdr);
    await refreshCachedPosition(agent);
    return json<TxSubmitResponse>({ hash: r.hash, status: "SUCCESS" });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof ContractCallError && e.code ? e.code : "TX_FAILED";
    throw new HttpError(400, code, message);
  }
});
