import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { onboardAgent } from "@/lib/agent";
import { verifyRegistration } from "@/lib/auth/passkey";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";

export const maxDuration = 60;

const Body = z.object({ response: z.record(z.string(), z.unknown()) });

/** Stores the passkey; for agents also deploys their smart account and creates the Lithic card (§4.2). */
export const POST = handle(async (req: Request) => {
  const { response } = await parseBody(req, Body);
  const s = await getSession();
  if (!s.userId || !s.regChallenge) throw new HttpError(401, "UNAUTHENTICATED", "Start passkey registration first");
  const user = await db.user.findUniqueOrThrow({ where: { id: s.userId } });
  const passkey = await verifyRegistration(user.id, response as unknown as RegistrationResponseJSON, s.regChallenge);
  s.regChallenge = undefined;
  s.prePasskey = false;
  await s.save();
  let smartAccount: string | null = null;
  if (user.role === "AGENT") {
    const agent = await onboardAgent(user.id, { publicKeyP256: passkey.publicKeyP256, credentialId: passkey.credentialId });
    smartAccount = agent.smartAccount;
  }
  return json({ ok: true, role: user.role, smartAccount });
});
