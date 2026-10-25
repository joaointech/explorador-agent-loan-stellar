import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { getSession } from "@/lib/auth/session";
import { badRequest, parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { authenticationResponseSchema, completeLogin } from "@/lib/passkey/server";
import type { PasskeyLoginVerifyResponse } from "@/lib/types/api";

// Spec §9.2: verify the assertion and start the session.
export const POST = route(async (req: Request) => {
  const body = (await parseBody(req, authenticationResponseSchema)) as unknown as AuthenticationResponseJSON;

  const session = await getSession();
  const expectedChallenge = session.challenge;
  if (!expectedChallenge) throw badRequest("No passkey sign-in in progress: start again", "NO_CHALLENGE");
  session.challenge = undefined; // single use
  await session.save();

  const user = await completeLogin(body, expectedChallenge);
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  session.passkeyVerified = true;
  await session.save();

  return jsonResponse<PasskeyLoginVerifyResponse>({
    user: { email: user.email, role: user.role },
    redirectTo: user.role === "ADMIN" ? "/admin" : "/agent",
  });
});
