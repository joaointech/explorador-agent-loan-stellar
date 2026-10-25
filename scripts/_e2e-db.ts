// Second import of scripts/e2e.ts: points DATABASE_URL at a separate `<db>_e2e` database
// (created / synced with `prisma db push`) before any lib module creates the Prisma client,
// so the e2e run never touches the demo data or the active deployment.
import "./_env";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { WEB_ROOT } from "../apps/web/lib/ops/load-env";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://advance:advance@localhost:5433/advance");
url.pathname = `${url.pathname.replace(/_e2e$/, "")}_e2e`;
process.env.DATABASE_URL = url.toString();

execFileSync(path.join(WEB_ROOT, "node_modules", ".bin", "prisma"), ["db", "push", "--url", url.toString()], {
  cwd: WEB_ROOT,
  env: process.env,
  stdio: ["ignore", "ignore", "inherit"],
});
console.log(`e2e database: ${url.pathname.slice(1)}`);
