// "Simulate purchase" (spec §4.4 step 1, §9.7 POST /api/agent/card/simulate).
// - Lithic (LITHIC_API_KEY set, Lithic-issued card): `simulate/authorize` with
//   the card's PAN; Lithic calls our ASA responder, which records the row and
//   schedules the draw. We read the decision back by transaction token.
// - Simulated network otherwise: build the ASA request ourselves and run the
//   same pipeline in-process; the caller schedules the returned follow-up.

import { APIError } from "lithic";
import { z } from "zod";

import { db, type CardAuthorization } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { parseAsaRequest } from "@/lib/lithic/asa";
import { cardPan } from "@/lib/lithic/cards";
import { getLithic, lithicEnabled } from "@/lib/lithic/client";
import { simulateAuthorization } from "@/lib/lithic/simulate";
import type { SimulateRequest, SimulateResponse } from "@/lib/types/api";
import { eurToCents } from "@/lib/units";

import { requireAgentCard, type AgentWithCard } from "./agent-card";
import { processAsaRequest } from "./asa";
import { buildSimulatedAsaRequest, isSimulatedToken } from "./simulated-network";

export const MAX_SIMULATED_EUR = 50_000;

export const simulateRequestSchema = z.object({
  amountEur: z
    .number()
    .positive()
    .max(MAX_SIMULATED_EUR)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "amountEur has at most 2 decimals"),
  merchant: z.string().trim().min(1).max(40),
}) satisfies z.ZodType<SimulateRequest>;

export interface SimulatedPurchase {
  response: SimulateResponse;
  /** In-process network only: the on-chain draw, to run with `after()`. */
  followUp: (() => Promise<void>) | null;
}

const toResponse = (row: Pick<CardAuthorization, "id" | "decision" | "declineReason">, via: SimulateResponse["via"]): SimulateResponse => ({
  authorizationId: row.id,
  decision: row.decision,
  declineReason: row.declineReason,
  via,
});

export interface SimulateOptions {
  /** How long to wait for our ASA responder's row after Lithic answers (it is normally there already). */
  asaWaitMs?: number;
}

export async function simulatePurchase(userId: string, input: SimulateRequest, opts: SimulateOptions = {}): Promise<SimulatedPurchase> {
  const card = await requireAgentCard(userId);
  const amountCents = eurToCents(input.amountEur);
  if (lithicEnabled() && !isSimulatedToken(card.cardToken)) {
    return { response: await simulateViaLithic(card, amountCents, input.merchant, opts.asaWaitMs ?? 4_000), followUp: null };
  }

  const request = buildSimulatedAsaRequest({
    cardToken: card.cardToken,
    last4: card.last4,
    memo: card.userId,
    amountCents,
    merchant: input.merchant,
  });
  const outcome = await processAsaRequest(parseAsaRequest(JSON.stringify(request)));
  if (!outcome.authorizationId || !outcome.decision) {
    throw new HttpError(500, "SIMULATION_NOT_RECORDED", `The simulated authorization was not recorded (${outcome.response.result})`);
  }
  return {
    response: toResponse({ id: outcome.authorizationId, decision: outcome.decision, declineReason: outcome.declineReason }, "simulated"),
    followUp: outcome.followUp,
  };
}

async function waitForAuthorization(lithicToken: string, timeoutMs: number): Promise<CardAuthorization | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await db.cardAuthorization.findUnique({ where: { lithicToken } });
    if (row || Date.now() >= deadline) return row;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function simulateViaLithic(card: AgentWithCard, amountCents: bigint, merchant: string, asaWaitMs: number): Promise<SimulateResponse> {
  const pan = await cardPan(card.cardToken);

  let token: string | undefined;
  try {
    ({ token } = await simulateAuthorization({ pan, amountCents, descriptor: merchant }));
  } catch (err) {
    // 422: Lithic refused the authorization itself; the body may still carry the transaction token.
    if (!(err instanceof APIError) || err.status !== 422) throw err;
    const body = err.error as { token?: string; message?: string } | undefined;
    token = body?.token;
    if (!token) throw new HttpError(422, "LITHIC_DECLINED", `Lithic declined the simulated purchase: ${body?.message ?? err.message}`);
  }
  if (!token) throw new HttpError(502, "LITHIC_NO_TOKEN", "Lithic did not return a transaction token");

  const recorded = await waitForAuthorization(token, asaWaitMs);
  if (recorded) return toResponse(recorded, "lithic");

  // No ASA request reached us: Lithic decided alone (pre-ASA checks, or no responder enrolled here).
  const transaction = await getLithic().transactions.retrieve(token).catch(() => null);
  if (transaction && transaction.result !== "APPROVED") {
    const declined = await db.cardAuthorization.upsert({
      where: { lithicToken: token },
      create: { lithicToken: token, agentId: card.userId, amountCents, merchant, decision: "DECLINED", declineReason: transaction.result },
      update: {},
    });
    return toResponse(declined, "lithic");
  }
  throw new HttpError(
    502,
    "ASA_NOT_REACHED",
    "Lithic authorized the purchase without calling this server's ASA responder; enroll a public URL with `pnpm lithic:enroll`",
  );
}
