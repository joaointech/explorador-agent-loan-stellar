// Test fixtures for the card workstream's database-backed tests (run against
// TEST_DATABASE_URL). Each test file uses its own email domain so files can
// run in parallel and clean up only their own rows.

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import type { AgentPosition, PoolStats } from "@/lib/types/chain";

export const EUR = 10_000_000n; // stroops

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export function chainPosition(over: Partial<AgentPosition> = {}): AgentPosition {
  return {
    cardBalance: 0n,
    cardEnabled: true,
    blocked: false,
    lines: [],
    carriedDebt: 0n,
    graceDeadline: null,
    totalDebt: 0n,
    totalPrincipal: 0n,
    availableCredit: 3_750n * EUR,
    borrowableNow: 3_750n * EUR,
    ...over,
  };
}

export function chainStats(over: Partial<PoolStats> = {}): PoolStats {
  return {
    seniorAssets: 100_000n * EUR,
    juniorAssets: 10_000n * EUR,
    feesAccrued: 0n,
    totalDebt: 0n,
    totalPrincipal: 0n,
    poolCash: 110_000n * EUR,
    totalCardBalances: 0n,
    shareSupply: 100_000n * EUR,
    sharePriceScaled: 10n ** 18n,
    utilizationBps: 0,
    leverageX100: 0,
    lendable: 110_000n * EUR,
    leverageHeadroom: 100_000n * EUR,
    borrowIndex: 10n ** 18n,
    protocolNow: 1_800_000_000n,
    params: {
      agentAprBps: 1200,
      protocolFeeBps: 1000,
      seniorTargetBps: 800,
      ltvBps: 5000,
      gracePeriodSecs: 15_552_000n,
      maxLeverage: 10,
      demoMode: true,
    },
    writtenOffTotal: 0n,
    ...over,
  };
}

export function testAgents(scope: string) {
  const domain = `${scope}.invalid`;

  async function create(over: { cardEnabledOnChain?: boolean; cardToken?: string | null } = {}) {
    const id = randomUUID();
    const user = await db.user.create({ data: { email: `agent-${id}@${domain}`, role: "AGENT" } });
    return db.agent.create({
      data: {
        userId: user.id,
        smartAccount: `C${id.replace(/-/g, "").toUpperCase()}TEST`,
        agentField: "00".repeat(32),
        lithicCardToken: over.cardToken === undefined ? `sim_card_${id}` : over.cardToken,
        cardLast4: over.cardToken === null ? null : "4242",
        cardEnabledOnChain: over.cardEnabledOnChain ?? true,
      },
    });
  }

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${domain}` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.cardAuthorization.deleteMany({ where: { agentId: { in: ids } } });
    await db.agent.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  return { create, cleanup };
}
