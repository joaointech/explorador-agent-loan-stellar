// Loads apps/web/.env.local (then .env) for scripts run outside Next.js.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

config({ path: [path.join(WEB_ROOT, ".env.local"), path.join(WEB_ROOT, ".env")], quiet: true });
