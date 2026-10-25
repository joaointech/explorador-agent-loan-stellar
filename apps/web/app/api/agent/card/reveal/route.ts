import type { CardRevealResponse } from "@/lib/api-types";
import { requireAgent } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { lithicEnabled, revealCard } from "@/lib/lithic";

export const dynamic = "force-dynamic";

/** Sandbox only: PAN/CVV straight from Lithic, never stored. */
export const GET = handle(async () => {
  const { userId } = await requireAgent();
  const agent = await db.agent.findUnique({ where: { userId } });
  if (!agent?.lithicCardToken || !lithicEnabled()) throw new HttpError(404, "NO_CARD", "No Lithic sandbox card for this agent");
  return json<CardRevealResponse>(await revealCard(agent.lithicCardToken), { headers: { "cache-control": "no-store" } });
});
