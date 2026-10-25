import { agentOverview } from "@/lib/agent";
import { requireAgent } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const { userId } = await requireAgent();
  await syncIfStale();
  return json(await agentOverview(userId));
});
