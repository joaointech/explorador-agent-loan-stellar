import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { provisionAgent } from "@/lib/agent/provision";
import { getSession, requireUser } from "@/lib/auth/session";
import { badRequest, parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { completeRegistration, registrationResponseSchema } from "@/lib/passkey/server";
import type { PasskeyRegisterVerifyResponse } from "@/lib/types/api";

// Deploying the smart account and creating the card can take ~15 s.
export const maxDuration = 60;

// Spec §9.2 / §4.2: verify + store the passkey; for agents, deploy the smart account and create the card.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = (await parseBody(req, registrationResponseSchema)) as unknown as RegistrationResponseJSON;

  const session = await getSession();
  const expectedChallenge = session.challenge;
  if (!expectedChallenge) throw badRequest("No passkey registration in progress: start again", "NO_CHALLENGE");
  session.challenge = undefined; // single use
  await session.save();

  const { credentialId } = await completeRegistration(user, body, expectedChallenge);
  session.passkeyVerified = true;
  await session.save();

  const provisioning = user.role === "AGENT" ? await provisionAgent(user.userId) : null;
  return jsonResponse<PasskeyRegisterVerifyResponse>({ verified: true, credentialId, role: user.role, provisioning });
});
