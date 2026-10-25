// pnpm lithic:clear
//
// Clears Lithic sandbox authorizations whose on-chain draw has confirmed but
// which Lithic still shows as PENDING: purchases made before the app cleared
// them automatically, or whose clearing call failed. The app now clears each
// authorization right after its draw confirms (lib/card/clearing.ts).
// Env comes from apps/web/.env.local.

import { loadEnv, logger } from "./env";

loadEnv();
const log = logger("lithic:clear");

const { db } = await import("@/lib/db");
const { getLithic, lithicEnabled } = await import("@/lib/lithic/client");
const { clearLithicAuthorization } = await import("@/lib/card/clearing");
const { isSimulatedToken } = await import("@/lib/card/simulated-network");

const eur = (cents: bigint) => `€${(Number(cents) / 100).toFixed(2)}`;

try {
  if (!lithicEnabled()) throw new Error("LITHIC_API_KEY is not set in apps/web/.env.local");
  const rows = await db.cardAuthorization.findMany({
    where: { decision: "APPROVED", chainStatus: "CONFIRMED" },
    select: { lithicToken: true, merchant: true, amountCents: true },
    orderBy: { createdAt: "asc" },
  });
  let cleared = 0;
  for (const row of rows) {
    if (isSimulatedToken(row.lithicToken)) continue;
    const label = `${row.merchant} ${eur(row.amountCents)}`;
    const tx = await getLithic()
      .transactions.retrieve(row.lithicToken)
      .catch(() => null);
    if (!tx) continue; // not a Lithic transaction of this account (e.g. seeded spends)
    if (tx.status !== "PENDING") {
      log(`${label}: already ${tx.status}`);
      continue;
    }
    const outcome = await clearLithicAuthorization(row.lithicToken);
    if (outcome === "cleared") cleared++;
    log(`${label}: ${outcome}`);
  }
  log(`${cleared} transaction(s) cleared`);
} catch (err) {
  console.error("[lithic:clear] FAILED", err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
