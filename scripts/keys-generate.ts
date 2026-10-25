// pnpm keys:generate — role keypairs (Friendbot-funded), attester key, secrets → apps/web/.env.local
import "./_env";
import { WEB_ROOT } from "../apps/web/lib/ops/load-env";
import { generateKeys } from "../apps/web/lib/ops/keys";

await generateKeys(WEB_ROOT);
console.log("Done. Testnet-only keys — never reuse them anywhere else.");
