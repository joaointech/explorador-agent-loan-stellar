// GET /api/agent/card/authorizations/[id]: the UI polls this after a
// purchase until the on-chain draw is CONFIRMED or FAILED.

import { db } from "@/lib/db";
import { notFound } from "@/lib/http";
import { explorerUrl } from "@/lib/stellar/contracts";
import type { AuthorizationStatusResponse } from "@/lib/types/api";

import { executeDraw } from "./draw";

/** An approved draw still PENDING after this long lost its after() (e.g. a function timeout): start it again. */
const REARM_AFTER_MS = 15_000;

export async function getAuthorizationStatus(
  agentId: string,
  id: string,
): Promise<{ status: AuthorizationStatusResponse; followUp: (() => Promise<void>) | null }> {
  const row = await db.cardAuthorization.findFirst({ where: { id, agentId } });
  if (!row) throw notFound("Authorization not found");

  const lost =
    row.decision === "APPROVED" &&
    row.chainStatus === "PENDING" &&
    row.amountCents > 0n &&
    Date.now() - row.createdAt.getTime() > REARM_AFTER_MS;

  return {
    status: {
      id: row.id,
      decision: row.decision,
      chainStatus: row.chainStatus,
      fromBalance: row.fromBalanceStroops?.toString() ?? null,
      fromCredit: row.fromCreditStroops?.toString() ?? null,
      txHash: row.txHash,
      explorerUrl: row.txHash ? explorerUrl("tx", row.txHash) : null,
    },
    followUp: lost
      ? async () => {
          await executeDraw(row.id).catch((err: unknown) => console.error(`[card] re-armed draw ${row.id} failed`, err));
        }
      : null,
  };
}
