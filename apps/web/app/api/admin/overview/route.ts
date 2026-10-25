import { after } from "next/server";
import { adminOverview } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";
import { retryDraws } from "@/lib/lithic/asa";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  await syncIfStale();
  // §9.5: the retry sweep is also triggered on admin page load.
  after(() => retryDraws().then(() => undefined).catch((e) => console.error("retryDraws", e)));
  return json(await adminOverview());
});
