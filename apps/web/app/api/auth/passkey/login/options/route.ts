import { getSession } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { buildLoginOptions } from "@/lib/passkey/server";

// Spec §9.2: discoverable-credential sign-in (no email needed).
export const POST = route(async () => {
  const options = await buildLoginOptions();
  const session = await getSession();
  session.challenge = options.challenge;
  await session.save();
  return jsonResponse(options);
});
