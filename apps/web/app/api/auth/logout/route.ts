import { getSession } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";

export const POST = handle(async () => {
  const s = await getSession();
  s.destroy();
  return json({ ok: true });
});
