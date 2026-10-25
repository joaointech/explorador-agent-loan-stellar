// "Reset demo" (§11.1): fresh contracts from the stored wasm (uploads are skipped when the
// network already has the code), cleared history, then the seed. Users, passkeys and agents'
// smart accounts are kept — they don't depend on the pool deployment.
import { db } from "@/lib/db";
import { invalidateNotes } from "@/lib/api/views";
import { deployAll, type Log } from "./deploy";
import { seedDemo } from "./seed";

export async function clearDeploymentData(log: Log) {
  await db.$transaction([
    db.cardAuthorization.deleteMany({}),
    db.cpcv.deleteMany({}),
    db.chainEvent.deleteMany({}),
    db.poolSnapshot.deleteMany({}),
    db.agent.updateMany({ data: { cardEnabledOnChain: false, cachedAt: null } }),
    db.$executeRaw`UPDATE "Agent" SET "cachedPosition" = NULL`,
  ]);
  invalidateNotes();
  log("Cleared card authorizations, CPCVs, chain events and snapshots");
}

export async function resetDemo(log: Log = console.log) {
  const t0 = Date.now();
  log("Deploying fresh contracts…");
  await deployAll(log);
  await clearDeploymentData(log);
  log("Seeding demo data…");
  await seedDemo(log);
  log(`Demo reset finished in ${Math.round((Date.now() - t0) / 1000)} s`);
}
