import { z } from "zod";
import { normalizeEmail, roleForEmail, verifyEmailCode } from "@/lib/auth/email";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";

const Body = z.object({ email: z.string().trim().email().max(200), code: z.string().trim().regex(/^\d{6}$/, "6-digit code") });

/**
 * Verifies the code. Users with a passkey are signed in (fallback login). Agents without one get
 * a pre-passkey session (they must create the passkey that controls their smart account), except
 * seed agents, whose accounts use a server-held demo signer (§11.2). Admins never sign on-chain,
 * so the email code is enough for them; a passkey is optional.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  const email = normalizeEmail(body.email);
  await verifyEmailCode(email, body.code);
  const user =
    (await db.user.findUnique({ where: { email }, include: { passkeys: { select: { id: true } }, agent: { select: { signerKind: true } } } })) ??
    (await db.user.create({
      data: { email, role: roleForEmail(email) },
      include: { passkeys: { select: { id: true } }, agent: { select: { signerKind: true } } },
    }));
  const exempt = user.role === "ADMIN" || user.agent?.signerKind === "demo-ed25519";
  const needsPasskey = user.passkeys.length === 0 && !exempt;
  const s = await getSession();
  s.userId = user.id;
  s.email = user.email;
  s.role = user.role;
  s.prePasskey = needsPasskey;
  await s.save();
  return json({ ok: true, role: user.role, needsPasskey });
});
