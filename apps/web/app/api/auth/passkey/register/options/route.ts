import { getSession, requireUser } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { buildRegistrationOptions } from "@/lib/passkey/server";

// Spec §9.2: passkey registration options for the signed-in (pre-passkey) user.
export const POST = route(async () => {
  const user = await requireUser();
  const options = await buildRegistrationOptions(user);
  const session = await getSession();
  session.challenge = options.challenge;
  await session.save();
  return jsonResponse(options);
});
