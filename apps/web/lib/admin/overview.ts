// GET /api/admin/overview: the dashboard's pool stats and alerts (spec §10.2):
// card spends whose on-chain draw failed ("unfunded card spend — covered by
// treasury", §4.4.6), agents past their grace deadline, the deployment and
// the protocol clock. Chain reads are best effort: what fails is reported in
// `warnings` so the dashboard still renders.

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { jsonify } from "@/lib/json";
import { getDeployment, readPoolStats } from "@/lib/stellar/contracts";
import type { AdminOverviewResponse } from "@/lib/types/api";
import { centsToStroops } from "@/lib/units";

import { listAdminAgents } from "./agents";
import { shortMessage } from "./chain-errors";
import { adminClock } from "./clock";

const FAILED_DRAWS_LIMIT = 50;

async function failedDraws(): Promise<AdminOverviewResponse["failedDraws"]> {
  const rows = await db.cardAuthorization.findMany({
    where: { decision: "APPROVED", chainStatus: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: FAILED_DRAWS_LIMIT,
    select: { id: true, merchant: true, amountCents: true, attempts: true, createdAt: true, agent: { select: { user: { select: { email: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    agentEmail: r.agent.user.email,
    merchant: r.merchant,
    amount: centsToStroops(r.amountCents).toString(),
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getAdminOverview(): Promise<AdminOverviewResponse> {
  const warnings: string[] = [];
  const [statsRead, deploymentRead, draws] = await Promise.all([
    readPoolStats().then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    ),
    getDeployment().then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    ),
    failedDraws(),
  ]);

  const stats = statsRead.ok ? statsRead.value : null;
  if (!statsRead.ok) warnings.push(`Pool stats unavailable: ${shortMessage(statsRead.reason)}`);
  if (!deploymentRead.ok) warnings.push(`Deployment unavailable: ${shortMessage(deploymentRead.reason)}`);

  const clock = stats
    ? adminClock(stats)
    : { protocolNow: Math.floor(Date.now() / 1000), offsetSecs: 0, demoMode: env().DEMO_MODE };
  const agents = await listAdminAgents(stats ? clock : null);

  return {
    failedDraws: draws,
    agentsPastGrace: agents.filter((a) => a.canWriteOff),
    deployment: deploymentRead.ok ? deploymentRead.value : null,
    clock,
    stats: stats ? jsonify(stats) : null,
    warnings,
  };
}
