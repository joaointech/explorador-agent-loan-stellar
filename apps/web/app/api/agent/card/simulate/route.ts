import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import type { CardSimulateResponse } from "@/lib/api-types";
import { requireAgent } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { lithicEnabled, simulateAuthorization } from "@/lib/lithic";
import { decideAuthorization, processDraw } from "@/lib/lithic/asa";

export const maxDuration = 60;

const Body = z.object({
  amountEur: z.number().positive().max(100_000),
  merchant: z.string().trim().min(1).max(60),
});

const lastCall = new Map<string, number>();

/**
 * Lithic mode: asks the sandbox to simulate an authorization; Lithic then calls our ASA endpoint.
 * Local mode (no LITHIC_API_KEY): runs the same ASA decision in-process with a synthetic token.
 */
export const POST = handle(async (req: Request) => {
  const { userId } = await requireAgent();
  const { amountEur, merchant } = await parseBody(req, Body);
  const agent = await db.agent.findUnique({ where: { userId } });
  if (!agent) throw new HttpError(409, "NOT_ONBOARDED", "Finish onboarding first");
  const now = Date.now();
  if (now - (lastCall.get(userId) ?? 0) < 1100) throw new HttpError(429, "SLOW_DOWN", "One simulated purchase per second, please");
  lastCall.set(userId, now);
  const amountCents = Math.round(amountEur * 100);

  if (lithicEnabled() && agent.lithicCardToken) {
    const sim = await simulateAuthorization(agent.lithicCardToken, amountCents, merchant);
    const token = (sim as { token?: string }).token ?? "";
    // The ASA request usually lands before simulateAuthorization returns.
    let row = token ? await db.cardAuthorization.findUnique({ where: { lithicToken: token } }) : null;
    for (let i = 0; !row && token && i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      row = await db.cardAuthorization.findUnique({ where: { lithicToken: token } });
    }
    return json<CardSimulateResponse>({
      token,
      mode: "lithic",
      decision: row ? row.decision : "PENDING",
      declineReason: row?.declineReason ?? null,
      authorizationId: row?.id ?? null,
    });
  }

  const token = `local-${randomUUID()}`;
  const decision = await decideAuthorization({
    token,
    status: "AUTHORIZATION",
    amount: amountCents,
    card: { token: agent.lithicCardToken ?? `local-card-${agent.userId}` },
    merchant: { descriptor: merchant },
  }, agent);
  if (decision.drawAuthorizationId) {
    const id = decision.drawAuthorizationId;
    after(() => processDraw(id).then(() => undefined));
  }
  return json<CardSimulateResponse>({
    token,
    mode: "local",
    decision: decision.result === "APPROVED" ? "APPROVED" : "DECLINED",
    declineReason: decision.result === "APPROVED" ? null : decision.result,
    authorizationId: decision.authorization?.id ?? null,
  });
});
