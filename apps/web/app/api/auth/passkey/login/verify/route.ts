import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthentication } from "@/lib/auth/passkey";
import { getSession } from "@/lib/auth/session";
import { handle, HttpError, json, parseBody } from "@/lib/http";

const Body = z.object({ response: z.record(z.string(), z.unknown()) });

export const POST = handle(async (req: Request) => {
  const { response } = await parseBody(req, Body);
  const s = await getSession();
  if (!s.loginChallenge) throw new HttpError(400, "NO_CHALLENGE", "Start passkey sign-in first");
  const user = await verifyAuthentication(response as unknown as AuthenticationResponseJSON, s.loginChallenge);
  s.loginChallenge = undefined;
  s.userId = user.id;
  s.email = user.email;
  s.role = user.role;
  s.prePasskey = false;
  await s.save();
  return json({ ok: true, role: user.role });
});
