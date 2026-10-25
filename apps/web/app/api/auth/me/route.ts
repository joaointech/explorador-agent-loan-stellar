import type { MeResponse } from "@/lib/api-types";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const s = await getSession();
  if (!s.userId) return json<MeResponse>({ user: null, prePasskey: false });
  const user = await db.user.findUnique({ where: { id: s.userId }, include: { agent: true, passkeys: { select: { id: true } } } });
  if (!user) return json<MeResponse>({ user: null, prePasskey: false });
  return json<MeResponse>({
    user: { id: user.id, email: user.email, role: user.role, hasPasskey: user.passkeys.length > 0, smartAccount: user.agent?.smartAccount ?? null },
    prePasskey: Boolean(s.prePasskey),
  });
});
