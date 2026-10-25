// pnpm seed — demo data (§11.2) on the active deployment.
import "./_env";
import { db } from "../apps/web/lib/db";
import { clearDeploymentData } from "../apps/web/lib/ops/reset";
import { seedDemo } from "../apps/web/lib/ops/seed";

if (process.argv.includes("--clear")) await clearDeploymentData(console.log);
await seedDemo();
await db.$disconnect();
// snarkjs / circomlibjs keep worker threads alive after proving; exit explicitly.
process.exit(0);
