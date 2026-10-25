// POST /api/auth/email/start {email} → sends a 6-digit sign-in code (spec §9.2).

import { discardEmailCode, EMAIL_CODE, issueEmailCode } from "@/lib/auth/email-code";
import { clientIp, enforceRateLimit } from "@/lib/auth/rate-limit";
import { assertJsonRequest } from "@/lib/auth/request";
import { emailStartBody } from "@/lib/auth/schemas";
import { isDemoEmail, roleForEmail } from "@/lib/auth/users";
import { db } from "@/lib/db";
import { EmailError } from "@/lib/email";
import { sendLoginCode } from "@/lib/email/login-code";
import { env } from "@/lib/env";
import { badRequest, HttpError, parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { EmailStartResponse } from "@/lib/types/api";

const TEN_MINUTES = 10 * 60 * 1000;

export const POST = route(async (req: Request) => {
  enforceRateLimit(`email-start:${clientIp(req)}`, 20, TEN_MINUTES, "sign-in requests");
  assertJsonRequest(req);
  const { email } = await parseBody(req, emailStartBody);

  // Seed accounts (@demo.explorador.pt) have no inbox and are never emailed.
  // In DEMO_MODE a seed agent's code is returned to the client; a seed admin's
  // only with the DEMO_ADMIN_SIGNIN opt-in (otherwise anyone could become
  // admin), else it is printed in the server console (DECISIONS.md).
  const demo = isDemoEmail(email);
  if (demo) {
    if (!env().DEMO_MODE) throw badRequest("Demo accounts can only sign in while demo mode is on.", "DEMO_DISABLED");
    const account = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!account) throw badRequest("There's no demo account with this email.", "DEMO_ACCOUNT_NOT_FOUND");
  }
  const revealCode = demo && (roleForEmail(email) !== "ADMIN" || env().DEMO_ADMIN_SIGNIN);

  // A code that is only emailed or logged keeps the normal hourly cap (it bounds guessing).
  const issued = await issueEmailCode(email, revealCode ? { maxPerHour: 30 } : {});

  let delivery: EmailStartResponse["delivery"] = "demo";
  if (revealCode) {
    console.info(`[auth] demo sign-in code for ${email}: ${issued.code}`);
  } else if (demo) {
    console.info(`[auth] sign-in code for the demo admin ${email}: ${issued.code} (set DEMO_ADMIN_SIGNIN=true to show it on the sign-in page)`);
    delivery = "console";
  } else {
    try {
      const sent = await sendLoginCode(email, issued.code, EMAIL_CODE.ttlMs / 60_000);
      delivery = sent.via === "resend" ? "email" : "console";
    } catch (err) {
      await discardEmailCode(issued.id);
      if (err instanceof EmailError) {
        console.error(`[auth] sign-in code email to ${email} failed: ${err.message}`);
        throw new HttpError(502, "EMAIL_FAILED", "We couldn't send the code. Please try again in a moment.");
      }
      throw err;
    }
  }

  return jsonResponse<EmailStartResponse>({
    email,
    expiresAt: issued.expiresAt.toISOString(),
    resendAfterSecs: EMAIL_CODE.resendCooldownMs / 1000,
    delivery,
    ...(revealCode ? { demoCode: issued.code } : {}),
  });
});
