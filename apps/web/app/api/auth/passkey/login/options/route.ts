import { authenticationOptions } from "@/lib/auth/passkey";
import { getSession } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";

export const POST = handle(async () => {
  const options = await authenticationOptions();
  const s = await getSession();
  s.loginChallenge = options.challenge;
  await s.save();
  return json(options);
});
