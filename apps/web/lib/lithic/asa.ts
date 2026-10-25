// Auth Stream Access decisions (§4.4, §9.5) and the asynchronous on-chain draw.
//
// The decision is made from cached on-chain state (RPC simulation with a 1.2 s budget,
// falling back to Agent.cachedPosition), minus this agent's approved-but-unconfirmed
// holds. The actual `card_draw` is submitted after the response is sent.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Agent, CardAuthorization } from "@/lib/generated/prisma/client";
import { db, toJson } from "@/lib/db";
import { env } from "@/lib/env";
import { positionDto, readPosition, readStats, statsDto, type RawAgentPosition, type RawPoolStats } from "@/lib/pool";
import { invokeAsOperator } from "@/lib/stellar/client";
import { ContractCallError } from "@/lib/stellar/errors";
import type { AgentPositionDto, PoolStatsDto } from "@/lib/api-types";

export const STROOPS_PER_CENT = 100_000n;
const READ_TIMEOUT_MS = 1200;
export const MAX_DRAW_ATTEMPTS = 3;

export type AsaResult = "APPROVED" | "INSUFFICIENT_FUNDS" | "CARD_PAUSED" | "SUSPECTED_FRAUD" | "UNAUTHORIZED_MERCHANT";

export interface AsaRequestBody {
  token: string;
  status: string;
  amount?: number;
  amounts?: { cardholder?: { amount?: number } };
  card?: { token?: string };
  merchant?: { descriptor?: string };
  [k: string]: unknown;
}

export interface AsaDecision {
  result: AsaResult;
  authorization: CardAuthorization | null;
  spendableStroops: bigint;
  /** set when a draw must be submitted after responding */
  drawAuthorizationId: string | null;
}

// ---------------------------------------------------------------- signatures

/** Verifies standard-webhooks (webhook-id/-timestamp/-signature) or legacy X-Lithic-HMAC headers. */
export function verifyAsaSignature(headers: Headers, rawBody: string, secret = env.lithicAsaSecret): boolean {
  if (!secret) return true;
  const sig = headers.get("webhook-signature");
  if (sig) {
    const id = headers.get("webhook-id") ?? "";
    const ts = headers.get("webhook-timestamp") ?? "";
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
    const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
    return sig.split(" ").some((part) => {
      const [, value] = part.split(",");
      return value ? safeEqual(value, expected) : false;
    });
  }
  const legacy = headers.get("x-lithic-hmac");
  if (legacy) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
    return safeEqual(legacy, expected);
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- spendable

export function authRef(lithicToken: string): Buffer {
  return createHash("sha256").update(lithicToken).digest();
}

export async function pendingHoldsCents(agentId: string, tx: Pick<typeof db, "cardAuthorization"> = db): Promise<bigint> {
  const rows = await tx.cardAuthorization.findMany({
    where: { agentId, decision: "APPROVED", chainStatus: { in: ["PENDING", "SUBMITTED"] } },
    select: { amountCents: true },
  });
  return rows.reduce((a, r) => a + r.amountCents, 0n);
}

interface CachedState {
  position: AgentPositionDto;
  stats: Pick<PoolStatsDto, "lendable" | "leverageHeadroom">;
}

/** Live position + stats within the ASA time budget, else the cached copy on the agent row. */
export async function positionForDecision(agent: Agent): Promise<CachedState | null> {
  try {
    const [pos, st] = await Promise.all([readPosition(agent.smartAccount, READ_TIMEOUT_MS), readStats(READ_TIMEOUT_MS)]);
    const state: CachedState = { position: positionDto(pos as RawAgentPosition), stats: pickStats(statsDto(st as RawPoolStats)) };
    void db.agent
      .update({ where: { userId: agent.userId }, data: { cachedPosition: toJson(state) as object, cachedAt: new Date() } })
      .catch(() => undefined);
    return state;
  } catch (e) {
    console.warn("ASA live read failed, using cached position", e instanceof Error ? e.message : e);
    const cached = agent.cachedPosition as unknown as CachedState | null;
    return cached?.position ? cached : null;
  }
}

function pickStats(st: PoolStatsDto) {
  return { lendable: st.lendable, leverageHeadroom: st.leverageHeadroom };
}

export function spendableStroops(state: CachedState, holdsCents: bigint): bigint {
  const p = state.position;
  const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
  const credit = p.blocked ? 0n : min(BigInt(p.availableCredit), BigInt(state.stats.lendable), BigInt(state.stats.leverageHeadroom));
  const s = BigInt(p.cardBalance) + (credit > 0n ? credit : 0n) - holdsCents * STROOPS_PER_CENT;
  return s > 0n ? s : 0n;
}

export async function refreshCachedPosition(agent: Pick<Agent, "userId" | "smartAccount">) {
  try {
    const [pos, st] = await Promise.all([readPosition(agent.smartAccount), readStats()]);
    const state: CachedState = { position: positionDto(pos), stats: pickStats(statsDto(st)) };
    await db.agent.update({ where: { userId: agent.userId }, data: { cachedPosition: toJson(state) as object, cachedAt: new Date() } });
  } catch (e) {
    console.warn("refreshCachedPosition failed", e);
  }
}

// ---------------------------------------------------------------- decision

/**
 * Decides an authorization and records it (idempotent on the Lithic token).
 * Used by POST /api/lithic/asa and by the local simulator when Lithic isn't configured.
 */
export async function decideAuthorization(body: AsaRequestBody, knownAgent?: Agent): Promise<AsaDecision> {
  const existing = await db.cardAuthorization.findUnique({ where: { lithicToken: body.token } });
  if (existing) {
    return {
      result: existing.decision === "APPROVED" ? "APPROVED" : ((existing.declineReason as AsaResult) ?? "INSUFFICIENT_FUNDS"),
      authorization: existing,
      spendableStroops: 0n,
      drawAuthorizationId: null,
    };
  }

  const cardToken = body.card?.token;
  const agent = knownAgent ?? (cardToken ? await db.agent.findUnique({ where: { lithicCardToken: cardToken } }) : null);
  if (!agent) return { result: "SUSPECTED_FRAUD", authorization: null, spendableStroops: 0n, drawAuthorizationId: null };

  const amountCents = BigInt(Math.max(0, Math.round(Number(body.amounts?.cardholder?.amount ?? body.amount ?? 0))));
  const merchant = String(body.merchant?.descriptor ?? "Card purchase").slice(0, 120);

  if (!agent.cardEnabledOnChain) {
    const row = await insertAuth(agent.userId, body.token, amountCents, merchant, "CARD_PAUSED");
    return { result: "CARD_PAUSED", authorization: row, spendableStroops: 0n, drawAuthorizationId: null };
  }

  const state = await positionForDecision(agent);

  // Row lock on the agent serializes concurrent decisions for the same card.
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "userId" FROM "Agent" WHERE "userId" = ${agent.userId} FOR UPDATE`;
    const dup = await tx.cardAuthorization.findUnique({ where: { lithicToken: body.token } });
    if (dup) {
      return { result: dup.decision === "APPROVED" ? "APPROVED" : "INSUFFICIENT_FUNDS", authorization: dup, spendableStroops: 0n, drawAuthorizationId: null } as AsaDecision;
    }
    const holds = await pendingHoldsCents(agent.userId, tx);
    const spendable = state ? spendableStroops(state, holds) : 0n;
    const approved = amountCents > 0n && amountCents * STROOPS_PER_CENT <= spendable && !state?.position.blocked;
    const row = await tx.cardAuthorization.create({
      data: {
        lithicToken: body.token,
        agentId: agent.userId,
        amountCents,
        merchant,
        decision: approved ? "APPROVED" : "DECLINED",
        declineReason: approved ? null : "INSUFFICIENT_FUNDS",
        chainStatus: approved ? "PENDING" : "CONFIRMED",
      },
    });
    return {
      result: approved ? "APPROVED" : "INSUFFICIENT_FUNDS",
      authorization: row,
      spendableStroops: spendable,
      drawAuthorizationId: approved ? row.id : null,
    } as AsaDecision;
  });
}

async function insertAuth(agentId: string, token: string, amountCents: bigint, merchant: string, reason: string) {
  return db.cardAuthorization.create({
    data: { lithicToken: token, agentId, amountCents, merchant, decision: "DECLINED", declineReason: reason, chainStatus: "CONFIRMED" },
  });
}

/** BALANCE_INQUIRY: spendable in cents. */
export async function balanceInquiry(body: AsaRequestBody) {
  const agent = body.card?.token ? await db.agent.findUnique({ where: { lithicCardToken: body.card.token } }) : null;
  if (!agent) return { result: "SUSPECTED_FRAUD" as AsaResult, cents: 0 };
  const state = await positionForDecision(agent);
  const holds = await pendingHoldsCents(agent.userId);
  const cents = state ? Number(spendableStroops(state, holds) / STROOPS_PER_CENT) : 0;
  return { result: "APPROVED" as AsaResult, cents };
}

// ---------------------------------------------------------------- on-chain draw

/** Submits `card_draw` for an approved authorization and records the outcome. */
export async function processDraw(authorizationId: string): Promise<CardAuthorization> {
  const auth = await db.cardAuthorization.findUniqueOrThrow({ where: { id: authorizationId }, include: { agent: true } });
  if (auth.decision !== "APPROVED" || auth.chainStatus === "CONFIRMED") return auth;
  if (auth.attempts >= MAX_DRAW_ATTEMPTS) return auth;
  await db.cardAuthorization.update({ where: { id: auth.id }, data: { chainStatus: "SUBMITTED", attempts: { increment: 1 } } });
  try {
    const { hash, result } = await invokeAsOperator<{ from_balance: bigint; from_credit: bigint }>("advancePool", "card_draw", {
      agent: auth.agent.smartAccount,
      amount: auth.amountCents * STROOPS_PER_CENT,
      auth_ref: authRef(auth.lithicToken),
    });
    const updated = await db.cardAuthorization.update({
      where: { id: auth.id },
      data: {
        chainStatus: "CONFIRMED",
        txHash: hash,
        fromBalanceStroops: BigInt(result?.from_balance ?? 0),
        fromCreditStroops: BigInt(result?.from_credit ?? 0),
        lastError: null,
      },
    });
    await refreshCachedPosition(auth.agent);
    return updated;
  } catch (e) {
    const code = e instanceof ContractCallError ? e.code : "";
    if (code === "DuplicateDraw") {
      // Already drawn on-chain (an earlier attempt landed); the indexer fills the split.
      return db.cardAuthorization.update({ where: { id: auth.id }, data: { chainStatus: "CONFIRMED", lastError: null } });
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error(`card_draw failed for ${auth.lithicToken}:`, message);
    return db.cardAuthorization.update({ where: { id: auth.id }, data: { chainStatus: "FAILED", lastError: message.slice(0, 500) } });
  }
}

/** Retries FAILED or stuck draws (≤ 3 attempts each). */
export async function retryDraws(): Promise<number> {
  const stuckBefore = new Date(Date.now() - 2 * 60_000);
  const rows = await db.cardAuthorization.findMany({
    where: {
      decision: "APPROVED",
      attempts: { lt: MAX_DRAW_ATTEMPTS },
      OR: [{ chainStatus: "FAILED" }, { chainStatus: { in: ["PENDING", "SUBMITTED"] }, createdAt: { lt: stuckBefore } }],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  for (const r of rows) await processDraw(r.id);
  return rows.length;
}
