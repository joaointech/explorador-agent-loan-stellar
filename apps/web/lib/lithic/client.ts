// Lithic sandbox client (spec §9.4). Shared with scripts (lithic:enroll), so
// no `server-only` import. When LITHIC_API_KEY is unset the app uses the
// built-in simulated card network instead (lib/card/simulated-network.ts).

import Lithic from "lithic";

import { env, requireEnv } from "@/lib/env";

/** Sandbox card program on a Visa test BIN (Mastercard: 00000000-0000-0000-2000-000000000000). */
export const SANDBOX_VISA_PROGRAM = "00000000-0000-0000-1000-000000000000";

/** True when a Lithic sandbox key is configured. */
export const lithicEnabled = (): boolean => env().LITHIC_API_KEY !== undefined;

let client: Lithic | undefined;

/** The sandbox client; throws if LITHIC_API_KEY is unset. */
export function getLithic(): Lithic {
  client ??= new Lithic({
    apiKey: requireEnv("LITHIC_API_KEY"),
    environment: "sandbox",
    // Ignore LITHIC_BASE_URL / LITHIC_WEBHOOK_SECRET from the environment: always the sandbox.
    baseURL: null,
    webhookSecret: null,
    maxRetries: 2, // the SDK honours `retry-after` on 429
    timeout: 15_000,
  });
  return client;
}
