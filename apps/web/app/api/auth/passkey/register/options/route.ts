import { registrationOptions } from "@/lib/auth/passkey";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";

export const POST = handle(async () => {
  const s = await getSession();
  if (!s.userId) throw new HttpError(401, "UNAUTHENTICATED", "Verify your email first");
  const user = await db.user.findUniqueOrThrow({ where: { id: s.userId } });
  const options = await registrationOptions(user);
  s.regChallenge = options.challenge;
  await s.save();
  return json(options);
});
