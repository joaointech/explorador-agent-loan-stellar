// The ASA handler pipeline (spec §9.5), shared by the HTTP responder
// (`POST /api/lithic/asa`, called by Lithic) and the in-process simulated card
// network: same decision, same CardAuthorization row, same async card_draw.
//
// 1. idempotency: a known transaction token returns the stored decision
// 2. unknown card → SUSPECTED_FRAUD
// 3. live position + stats (1.2 s budget) or the cached position
// 4. card not enabled on-chain → CARD_PAUSED (live card_enabled, else the
//    Agent.cardEnabledOnChain mirror)
// 5. under a row lock on the agent: pending holds, decision, insert
// 6. the caller responds and runs `followUp` after the response (`after()`):
//    card_draw for approved spends, then cache/mirror sync from the live read

import { db, Prisma, type CardAuthorization } from "@/lib/db";
import { asaAmountCents, asaMerchant, isAsaResult, type AsaRequest, type AsaResponse, type AsaResult } from "@/lib/lithic/asa";
import { stroopsToEur } from "@/lib/units";

import { classifyStatus, decideAuthorization, sumPendingHolds, type Decision, type PositionSnapshot } from "./decision";
import { executeDraw } from "./draw";
import { loadDecisionState, syncAgentFromChain, type DecisionState } from "./position";

export interface AsaOutcome {
  /** Body for Lithic (HTTP 200). */
  response: AsaResponse;
  /** The CardAuthorization row; null when nothing was recorded (unknown card, balance inquiry). */
  authorizationId: string | null;
  decision: "APPROVED" | "DECLINED" | null;
  declineReason: string | null;
  /** Work to run once the response is sent; schedule it with `after()`. */
  followUp: (() => Promise<void>) | null;
}

const LOG = "[asa]";

function safely(label: string, fn: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`${LOG} ${label} failed`, err);
    }
  };
}

const drawFollowUp = (authorizationId: string) => safely(`card_draw for ${authorizationId}`, () => executeDraw(authorizationId));

/** Replays a recorded decision. Re-arms the draw if it never started (e.g. the process died before after() ran). */
function storedOutcome(row: CardAuthorization): AsaOutcome {
  const approved = row.decision === "APPROVED";
  const result: AsaResult = approved ? "APPROVED" : isAsaResult(row.declineReason) ? row.declineReason : "INSUFFICIENT_FUNDS";
  const undrawn = approved && row.chainStatus === "PENDING" && row.amountCents > 0n;
  return {
    response: { result, token: row.lithicToken },
    authorizationId: row.id,
    decision: row.decision,
    declineReason: row.declineReason,
    followUp: undrawn ? drawFollowUp(row.id) : null,
  };
}

function holdCandidatesWhere(agentId: string, position: PositionSnapshot): Prisma.CardAuthorizationWhereInput {
  const statuses: Prisma.CardAuthorizationWhereInput[] = [{ chainStatus: { in: ["PENDING", "SUBMITTED"] } }];
  if (position.source === "cache" && position.cachedAt) {
    statuses.push({ chainStatus: "CONFIRMED", createdAt: { gt: position.cachedAt } });
  }
  return { agentId, decision: "APPROVED", amountCents: { gt: 0 }, OR: statuses };
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export async function processAsaRequest(req: AsaRequest): Promise<AsaOutcome> {
  const started = Date.now();

  const existing = await db.cardAuthorization.findUnique({ where: { lithicToken: req.token } });
  if (existing) {
    console.info(`${LOG} ${req.token} replayed: ${existing.decision}`);
    return storedOutcome(existing);
  }

  const kind = classifyStatus(req.status);
  const amountCents = asaAmountCents(req) ?? 0n;
  const agent = await db.agent.findUnique({
    where: { lithicCardToken: req.card.token },
    select: { userId: true, smartAccount: true, cardEnabledOnChain: true, cachedPosition: true, cachedAt: true },
  });

  if (!agent) {
    console.warn(`${LOG} ${req.token} ${req.status} on unknown card ${req.card.token}: SUSPECTED_FRAUD`);
    return { response: { result: "SUSPECTED_FRAUD", token: req.token }, authorizationId: null, decision: null, declineReason: null, followUp: null };
  }

  // Skip the RPC reads when the answer cannot depend on them (zero amounts, credits).
  const needsPosition = kind === "balance_inquiry" || (kind === "purchase" && amountCents > 0n);
  const state: DecisionState | null = needsPosition ? await loadDecisionState(agent) : null;
  const position = state?.position ?? null;

  type Locked = { replay: CardAuthorization } | { replay: null; decision: Decision; row: CardAuthorization | null };
  let locked: Locked;
  try {
    locked = await db.$transaction(
      async (tx): Promise<Locked> => {
        // Serializes this agent's authorizations so concurrent ones see each other's holds.
        await tx.$queryRaw`SELECT 1 FROM "Agent" WHERE "userId" = ${agent.userId} FOR UPDATE`;
        const raced = await tx.cardAuthorization.findUnique({ where: { lithicToken: req.token } });
        if (raced) return { replay: raced };

        const holds = position
          ? sumPendingHolds(
              await tx.cardAuthorization.findMany({
                where: holdCandidatesWhere(agent.userId, position),
                select: { decision: true, chainStatus: true, amountCents: true, createdAt: true },
              }),
              position,
            )
          : 0n;
        const decision = decideAuthorization({ kind, amountCents, agent, position, stats: state?.stats ?? null, pendingHolds: holds });
        if (!decision.record) return { replay: null, decision, row: null };

        const approved = decision.result === "APPROVED";
        const row = await tx.cardAuthorization.create({
          data: {
            lithicToken: req.token,
            agentId: agent.userId,
            amountCents,
            merchant: asaMerchant(req),
            decision: approved ? "APPROVED" : "DECLINED",
            declineReason: approved ? null : decision.result,
            // Approved with nothing to draw (credits, zero amounts) is final; spends start PENDING.
            ...(approved && !decision.draw ? { chainStatus: "CONFIRMED" as const } : {}),
          },
        });
        return { replay: null, decision, row };
      },
      { maxWait: 1_000, timeout: 2_000 },
    );
  } catch (err) {
    // A concurrent request with the same token won the insert.
    const stored = isUniqueViolation(err) ? await db.cardAuthorization.findUnique({ where: { lithicToken: req.token } }) : null;
    if (stored) return storedOutcome(stored);
    throw err;
  }
  if (locked.replay) return storedOutcome(locked.replay);
  const { decision, row } = locked;

  const elapsed = Date.now() - started;
  const source = position ? position.source : "none";
  console.info(
    `${LOG} ${req.token} ${req.status} €${(Number(amountCents) / 100).toFixed(2)} → ${decision.result} ` +
      `(spendable €${stroopsToEur(decision.spendable).toFixed(2)}, position ${source}, ${elapsed} ms)`,
  );
  if (elapsed > 1_500) console.warn(`${LOG} ${req.token} decision took ${elapsed} ms (Lithic budget: respond < 2 s)`);

  // Draw first (the UI waits on it), then keep the cache and the card_enabled mirror current.
  const live = state?.live ?? null;
  const tasks: (() => Promise<void>)[] = [];
  if (row && decision.draw) tasks.push(drawFollowUp(row.id));
  if (live && state) tasks.push(safely("agent sync", () => syncAgentFromChain(agent, live, state.readStartedAt)));
  const followUp = tasks.length
    ? async () => {
        for (const task of tasks) await task();
      }
    : null;

  const response: AsaResponse = { result: decision.result, token: req.token };
  if (decision.balance) response.balance = decision.balance;
  return {
    response,
    authorizationId: row?.id ?? null,
    decision: row?.decision ?? null,
    declineReason: row?.declineReason ?? null,
    followUp,
  };
}
