// Demo data wipe before a reseed (spec §11.2, "Reset demo"). Everything tied
// to the previous deployment goes: CPCVs, card authorizations, indexed events,
// pool snapshots and indexer cursors. Users, passkeys and Agent rows stay:
// smart accounts live on-chain independently of our contracts (their addresses
// are deterministic), so real agents keep their login and wallet; their card
// consent is per pool, so `cardEnabledOnChain` is reset and they activate the
// card again (one passkey prompt) on the new deployment.

import { db, Prisma } from "@/lib/db";

import type { Log } from "./accounts";

export async function wipeDemoData(log: Log): Promise<void> {
  const [auths, cpcvs, events, snapshots, cursors] = await db.$transaction([
    db.cardAuthorization.deleteMany({}),
    db.cpcv.deleteMany({}),
    db.chainEvent.deleteMany({}),
    db.poolSnapshot.deleteMany({}),
    db.indexerCursor.deleteMany({}),
  ]);
  const agents = await db.agent.updateMany({ data: { cardEnabledOnChain: false, cachedPosition: Prisma.DbNull, cachedAt: null } });
  log(
    `wiped ${cpcvs.count} CPCVs, ${auths.count} card authorizations, ${events.count} events, ${snapshots.count} snapshots, ${cursors.count} cursors; ` +
      `${agents.count} agents keep their account (card to be re-activated)`,
  );
}
