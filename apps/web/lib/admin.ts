// Admin operations (§4.5, §4.6, §9.7) shared by the admin routes, the seed and e2e scripts.
import type { AdminAgentDto, AdminCpcvDto, AdminOverviewResponse, FailedDrawDto } from "@/lib/api-types";
import { invalidateNotes, poolStatsResponse } from "@/lib/api/views";
import { decryptPii } from "@/lib/crypto/pii";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Agent, Cpcv, User } from "@/lib/generated/prisma/client";
import { HttpError } from "@/lib/http";
import { MAX_DRAW_ATTEMPTS, refreshCachedPosition } from "@/lib/lithic/asa";
import { DAY, positionDto, readLine, readPosition, readProtocolNow } from "@/lib/pool";
import { invoke, invokeAsOperator, readContract } from "@/lib/stellar/client";
import { getContracts } from "@/lib/stellar/contracts";
import { publicKey } from "@/lib/stellar/network";

const STROOPS_PER_CENT = 100_000n;

type CpcvWithAgent = Cpcv & { agent: Agent & { user: User } };

// ---------------------------------------------------------------- CPCV DTOs

export async function adminCpcvDto(c: CpcvWithAgent, today: number, debt?: string | null): Promise<AdminCpcvDto> {
  const agentStroops = c.agentCommissionCents * STROOPS_PER_CENT;
  return {
    id: c.id,
    agentId: c.agentId,
    agentEmail: c.agent.user.email,
    agentName: c.agent.user.displayName,
    smartAccount: c.agent.smartAccount,
    pii: decryptPii(c.piiEncrypted),
    totalCommission: (c.totalCommissionCents * STROOPS_PER_CENT).toString(),
    agentCommission: agentStroops.toString(),
    creditLimit: ((agentStroops * 5000n) / 10000n).toString(),
    escrituraDay: c.escrituraDay,
    status: c.status,
    noteId: c.noteId,
    mintTxHash: c.mintTxHash,
    settleTxHash: c.settleTxHash,
    cancelTxHash: c.cancelTxHash,
    error: c.error,
    overdue: c.status === "MINTED" && today > c.escrituraDay,
    debt: debt ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listCpcvs(): Promise<AdminCpcvDto[]> {
  const rows = await db.cpcv.findMany({ include: { agent: { include: { user: true } } }, orderBy: { createdAt: "desc" } });
  const today = Math.floor((await readProtocolNow()) / DAY);
  const debts = await Promise.all(
    rows.map((r) =>
      r.status === "MINTED" && r.noteId
        ? readLine(r.noteId)
            .then((l) => l.debt.toString())
            .catch(() => null)
        : Promise.resolve(null),
    ),
  );
  return Promise.all(rows.map((r, i) => adminCpcvDto(r, today, debts[i])));
}

export async function getCpcv(id: string): Promise<AdminCpcvDto> {
  const row = await db.cpcv.findUnique({ where: { id }, include: { agent: { include: { user: true } } } });
  if (!row) throw new HttpError(404, "NOT_FOUND", "CPCV not found");
  const today = Math.floor((await readProtocolNow()) / DAY);
  const debt = row.status === "MINTED" && row.noteId ? await readLine(row.noteId).then((l) => l.debt.toString()).catch(() => null) : null;
  return adminCpcvDto(row, today, debt);
}

// ---------------------------------------------------------------- deal outcomes

async function mintedCpcv(id: string) {
  const row = await db.cpcv.findUnique({ where: { id }, include: { agent: true } });
  if (!row) throw new HttpError(404, "NOT_FOUND", "CPCV not found");
  if (row.status !== "MINTED" || !row.noteId) throw new HttpError(409, "NOT_ACTIVE", "Only minted (active) notes can be settled or cancelled");
  return row as typeof row & { noteId: number };
}

/** Escritura: operator + treasury sign `settle(note_id)`. */
export async function settleCpcv(id: string) {
  const row = await mintedCpcv(id);
  const { hash } = await invokeAsOperator("advancePool", "settle", { note_id: row.noteId }, ["treasury"]);
  await db.cpcv.update({ where: { id }, data: { status: "SETTLED", settleTxHash: hash } });
  invalidateNotes();
  await refreshCachedPosition(row.agent);
  return { txHash: hash };
}

/** Buyer walked away: `cancel(note_id)` moves the line's debt to carried debt. */
export async function cancelCpcv(id: string) {
  const row = await mintedCpcv(id);
  const { hash } = await invokeAsOperator("advancePool", "cancel", { note_id: row.noteId });
  await db.cpcv.update({ where: { id }, data: { status: "CANCELLED", cancelTxHash: hash } });
  invalidateNotes();
  await refreshCachedPosition(row.agent);
  return { txHash: hash };
}

export async function writeOffAgent(userId: string) {
  const agent = await db.agent.findUnique({ where: { userId } });
  if (!agent) throw new HttpError(404, "NOT_FOUND", "Agent not found");
  const { hash } = await invokeAsOperator("advancePool", "write_off", { agent: agent.smartAccount });
  await db.cpcv.updateMany({ where: { agentId: userId, status: "CANCELLED" }, data: { status: "WRITTEN_OFF" } });
  invalidateNotes();
  await refreshCachedPosition(agent);
  return { txHash: hash };
}

export async function treasuryCall(fn: "junior_deposit" | "junior_withdraw" | "claim_fees", amountEur: number) {
  const amount = BigInt(Math.round(amountEur * 100)) * STROOPS_PER_CENT;
  if (amount <= 0n) throw new HttpError(400, "VALIDATION", "Amount must be positive");
  const { hash } = await invoke("advancePool", fn, { amount }, { source: "treasury" });
  return { txHash: hash };
}

export async function advanceClock(req: { days?: number; toGraceOf?: string }) {
  if (!env.demoMode) throw new HttpError(403, "DEMO_MODE_DISABLED", "The protocol clock can only be moved on demo deployments");
  let secs: bigint;
  if (req.toGraceOf) {
    const agent = await db.agent.findUnique({ where: { userId: req.toGraceOf } });
    if (!agent) throw new HttpError(404, "NOT_FOUND", "Agent not found");
    const pos = await readPosition(agent.smartAccount);
    if (pos.grace_deadline === null || pos.grace_deadline === undefined) throw new HttpError(409, "NO_GRACE", "This agent has no grace deadline");
    const now = BigInt(await readProtocolNow());
    const deadline = BigInt(pos.grace_deadline);
    secs = deadline > now ? deadline - now + 60n : 60n;
  } else {
    const days = req.days ?? 0;
    if (!Number.isInteger(days) || days < 1 || days > 400) throw new HttpError(400, "VALIDATION", "days must be an integer between 1 and 400");
    secs = BigInt(days * DAY);
  }
  const { hash } = await invoke("advancePool", "advance_clock", { secs }, { source: "admin" });
  invalidateNotes();
  return { txHash: hash };
}

// ---------------------------------------------------------------- agents + overview

export async function listAgents(): Promise<AdminAgentDto[]> {
  const agents = await db.agent.findMany({ include: { user: true, cpcvs: { select: { noteId: true } } }, orderBy: { user: { createdAt: "asc" } } });
  const now = await readProtocolNow();
  const positions = await Promise.all(agents.map((a) => readPosition(a.smartAccount).catch(() => null)));
  return agents.map((a, i) => {
    const raw = positions[i];
    const p = raw ? positionDto(raw) : null;
    const grace = p?.graceDeadline ?? null;
    const carried = BigInt(p?.carriedDebt ?? "0");
    return {
      userId: a.userId,
      email: a.user.email,
      displayName: a.user.displayName,
      smartAccount: a.smartAccount,
      signerKind: a.signerKind,
      cardLast4: a.cardLast4,
      cardEnabled: p?.cardEnabled ?? a.cardEnabledOnChain,
      noteIds: a.cpcvs.map((c) => c.noteId).filter((n): n is number => n !== null),
      debt: p?.totalDebt ?? "0",
      carriedDebt: carried.toString(),
      cardBalance: p?.cardBalance ?? "0",
      graceDeadline: grace,
      blocked: p?.blocked ?? false,
      canWriteOff: carried > 0n && grace !== null && now >= grace,
    };
  });
}

export async function adminOverview(): Promise<AdminOverviewResponse> {
  const [pool, failed, agents, contracts, treasuryBal] = await Promise.all([
    poolStatsResponse(),
    db.cardAuthorization.findMany({
      where: { decision: "APPROVED", chainStatus: "FAILED" },
      include: { agent: { include: { user: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    listAgents(),
    getContracts().catch(() => null),
    readContract<bigint>("teurc", "balance", { account: publicKey("treasury") }).catch(() => 0n),
  ]);
  const failedDraws: FailedDrawDto[] = failed.map((f) => ({
    id: f.id,
    agentEmail: f.agent.user.email,
    merchant: f.merchant,
    amountCents: Number(f.amountCents),
    attempts: f.attempts,
    lastError: f.lastError ? `${f.lastError}${f.attempts >= MAX_DRAW_ATTEMPTS ? " (no more retries)" : ""}` : null,
    createdAt: f.createdAt.toISOString(),
  }));
  const now = pool.stats.protocolNow;
  return {
    pool,
    failedDraws,
    agentsPastGrace: agents
      .filter((a) => a.graceDeadline !== null && BigInt(a.carriedDebt) > 0n && now >= a.graceDeadline)
      .map((a) => ({ userId: a.userId, email: a.email, carriedDebt: a.carriedDebt, graceDeadline: a.graceDeadline! })),
    deployment: contracts
      ? {
          network: contracts.network,
          teurc: contracts.teurc,
          cpcvNote: contracts.cpcvNote,
          advancePool: contracts.advancePool,
          createdAt: contracts.createdAt ?? new Date().toISOString(),
          wasmHashes: contracts.wasmHashes,
        }
      : null,
    treasury: { address: publicKey("treasury"), teurcBalance: BigInt(treasuryBal).toString() },
  };
}

