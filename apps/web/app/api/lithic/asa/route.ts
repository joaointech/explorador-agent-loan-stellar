// POST /api/lithic/asa: Lithic Auth Stream Access responder (spec §9.5).
// Lithic needs a 200 with {"result": …} within its time budget (we target
// < 2 s); the on-chain card_draw runs after the response via after().
// Non-200 answers decline the authorization (5xx is retried once by Lithic).

import { after } from "next/server";

import { processAsaRequest } from "@/lib/card/asa";
import { env } from "@/lib/env";
import { route } from "@/lib/http";
import { parseAsaRequest } from "@/lib/lithic/asa";
import { verifyAsaSignature } from "@/lib/lithic/webhook";

// Room for card_draw (submit + confirm on testnet) inside after().
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  const raw = await req.text();
  const secret = env().LITHIC_ASA_HMAC_SECRET;
  if (secret) verifyAsaSignature(raw, req.headers, secret);

  const outcome = await processAsaRequest(parseAsaRequest(raw));
  if (outcome.followUp) after(outcome.followUp);
  return Response.json(outcome.response);
});
