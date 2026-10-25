// pnpm lithic:enroll — enrolls ${APP_URL}/api/lithic/asa as the ASA responder and stores the HMAC secret.
// Local dev needs a public URL: run a tunnel (cloudflared/ngrok) and pass it with --url or set APP_URL.
import "./_env";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "../apps/web/lib/env";
import { lithic } from "../apps/web/lib/lithic";
import { WEB_ROOT } from "../apps/web/lib/ops/load-env";

const urlArg = process.argv.indexOf("--url");
const base = (urlArg > 0 ? process.argv[urlArg + 1] : env.appUrl).replace(/\/$/, "");
if (/localhost|127\.0\.0\.1/.test(base)) {
  console.warn(`warning: ${base} is not reachable from Lithic. Use a tunnel: pnpm lithic:enroll --url https://<tunnel-host>`);
}
const url = `${base}/api/lithic/asa`;
const l = lithic();
const res = await l.responderEndpoints.create({ type: "AUTH_STREAM_ACCESS", url });
console.log(`enrolled ${url}:`, res);
const { secret } = await l.authStreamEnrollment.retrieveSecret();
if (!secret) throw new Error("Lithic returned no ASA secret");
const file = path.join(WEB_ROOT, ".env.local");
const text = readFileSync(file, "utf8");
const next = /^LITHIC_ASA_HMAC_SECRET=.*$/m.test(text)
  ? text.replace(/^LITHIC_ASA_HMAC_SECRET=.*$/m, `LITHIC_ASA_HMAC_SECRET=${secret}`)
  : `${text.trimEnd()}\nLITHIC_ASA_HMAC_SECRET=${secret}\n`;
writeFileSync(file, next);
console.log("LITHIC_ASA_HMAC_SECRET saved to apps/web/.env.local (restart the dev server).");
