// pnpm lithic:enroll [--url <public base url>] [--status] [--disenroll]
//
// Enrolls `${APP_URL}/api/lithic/asa` as this Lithic sandbox instance's Auth
// Stream Access responder, fetches the ASA HMAC secret and prints the
// .env.local line (spec §9.4, §11.1). Lithic must reach the URL: for local dev
// expose the dev server with a tunnel first, e.g.
//   cloudflared tunnel --url http://localhost:3000     (or: ngrok http 3000)
// and pass the tunnel's https URL with --url. Env comes from apps/web/.env.local.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { env } from "@/lib/env";
import { asaResponderStatus, asaResponderUrl, disenrollAsaResponder, enrollAsaResponder, isPublicUrl } from "@/lib/lithic/enroll";

const envFile = fileURLToPath(new URL("../apps/web/.env.local", import.meta.url));
// Values already in the shell environment win over the file.
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    status: { type: "boolean", default: false },
    disenroll: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

function usage(): never {
  console.log(`Usage: pnpm lithic:enroll [--url https://<public-host>] [--status] [--disenroll]

  (default)    enroll <url or APP_URL>/api/lithic/asa as the ASA responder and print LITHIC_ASA_HMAC_SECRET
  --url        public base URL Lithic can reach (overrides APP_URL), e.g. a cloudflared/ngrok tunnel
  --status     show what is enrolled now
  --disenroll  remove the ASA responder (simulated authorizations are then approved by Lithic alone)`);
  process.exit(0);
}

async function main() {
  if (args.help) usage();
  if (!env().LITHIC_API_KEY) {
    console.error("LITHIC_API_KEY is not set (apps/web/.env.local). Without it the app uses its built-in simulated card network; nothing to enroll.");
    process.exit(1);
  }

  if (args.status) {
    const status = await asaResponderStatus();
    console.log(status.enrolled ? `ASA responder enrolled: ${status.url}` : "No ASA responder enrolled.");
    return;
  }

  if (args.disenroll) {
    await disenrollAsaResponder();
    console.log("ASA responder disenrolled.");
    return;
  }

  const baseUrl = args.url ?? env().APP_URL;
  const target = asaResponderUrl(baseUrl);
  if (!isPublicUrl(target)) {
    console.warn(`Warning: ${target} is not publicly reachable, so Lithic cannot call it.`);
    console.warn("Start a tunnel (cloudflared tunnel --url http://localhost:3000, or ngrok http 3000) and pass --url <https tunnel URL>.\n");
  }

  const { url, replaced, secret } = await enrollAsaResponder(baseUrl);
  console.log(`ASA responder enrolled: ${url}${replaced ? ` (replaced ${replaced})` : ""}`);
  console.log("\nAdd this line to apps/web/.env.local and restart the dev server:\n");
  console.log(`LITHIC_ASA_HMAC_SECRET=${secret}`);
  console.log(
    "\nLithic starts signing ASA requests (webhook-id/-timestamp/-signature) a few minutes after the secret is first created." +
      "\nOnce LITHIC_ASA_HMAC_SECRET is set, unsigned requests are rejected: if early purchases decline, wait a few minutes and retry.",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
