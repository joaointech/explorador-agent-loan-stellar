// pnpm lithic:cards [--agent <email>]
//
// Issues a Lithic sandbox virtual card (spec §9.4) for every agent still on a
// simulated card, e.g. agents created before LITHIC_API_KEY was configured.
// `createAgentCard` is idempotent and replaces a simulated card with a Lithic
// one; on-chain card consent (`enable_card`) is per agent, so nothing has to
// be re-activated. Env comes from apps/web/.env.local.

import { parseArgs } from "node:util";

import { loadEnv, logger } from "./env";

loadEnv();
const log = logger("lithic:cards");

const { values } = parseArgs({ options: { agent: { type: "string" } } });

const { db } = await import("@/lib/db");
const { lithicEnabled } = await import("@/lib/lithic/client");
const { createAgentCard } = await import("@/lib/lithic/cards");
const { isSimulatedToken } = await import("@/lib/card/simulated-network");

try {
  if (!lithicEnabled()) throw new Error("LITHIC_API_KEY is not set in apps/web/.env.local");
  const agents = await db.agent.findMany({
    where: values.agent ? { user: { email: values.agent.trim().toLowerCase() } } : {},
    select: { userId: true, lithicCardToken: true, cardLast4: true, user: { select: { email: true } } },
    orderBy: { user: { email: "asc" } },
  });
  if (agents.length === 0) log(values.agent ? `No agent with email ${values.agent}` : "No agents yet");
  for (const a of agents) {
    if (a.lithicCardToken && !isSimulatedToken(a.lithicCardToken)) {
      log(`${a.user.email}: already on Lithic card ••${a.cardLast4}`);
      continue;
    }
    const card = await createAgentCard(a.userId);
    log(`${a.user.email}: simulated ••${a.cardLast4 ?? "none"} → Lithic sandbox card ••${card.last4}`);
  }
} catch (err) {
  console.error("[lithic:cards] FAILED", err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
