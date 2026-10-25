// GET /api/auth/session → { user: SessionUser | null }
// DELETE /api/auth/session → signs out, { user: null }

import { getSessionUser, signOut } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { SessionResponse } from "@/lib/types/api";

const noStore = { headers: { "Cache-Control": "no-store" } };

export const GET = route(async () => jsonResponse<SessionResponse>({ user: await getSessionUser() }, noStore));

export const DELETE = route(async () => {
  await signOut();
  return jsonResponse<SessionResponse>({ user: null }, noStore);
});
