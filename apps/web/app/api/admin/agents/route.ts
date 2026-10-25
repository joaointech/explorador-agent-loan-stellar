import type { AdminAgentsResponse } from "@/lib/api-types";
import { listAgents } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  return json<AdminAgentsResponse>({ agents: await listAgents() });
});
