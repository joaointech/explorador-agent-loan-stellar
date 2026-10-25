// pnpm demo:reset — redeploy from the stored wasm + reseed (same code as the admin button).
import "./_env";
import { db } from "../apps/web/lib/db";
import { resetDemo } from "../apps/web/lib/ops/reset";

await resetDemo();
await db.$disconnect();
// snarkjs / circomlibjs keep worker threads alive after proving; exit explicitly.
process.exit(0);
