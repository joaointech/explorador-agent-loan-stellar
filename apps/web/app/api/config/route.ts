// GET /api/config (public): deployment ids and flags for client-side code.

import { env } from "@/lib/env";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { getDeployment } from "@/lib/stellar/contracts";
import type { ConfigResponse } from "@/lib/types/api";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const body: ConfigResponse = {
    deployment: await getDeployment(),
    demoMode: env().DEMO_MODE,
    lithicEnabled: Boolean(env().LITHIC_API_KEY),
  };
  return jsonResponse(body);
});
