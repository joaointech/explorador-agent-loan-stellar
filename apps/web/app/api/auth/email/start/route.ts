// POST /api/auth/email/start {email} → sends a 6-digit sign-in code (spec §9.2).

import { discardEmailCode, EMAIL_CODE, issueEmailCode } from "@/lib/auth/email-code";
import { clientIp, enforceRateLimit } from "@/lib/auth/rate-limit";
import { emailStartBody } from "@/lib/auth/schemas";
import { isDemoEmail } from "@/lib/auth/users";
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
  const { email } = await parseBody(req, emailStartBody);

  // Seed agents (@demo.explorador.pt) have no inbox: in DEMO_MODE their code
  // is returned to the client instead of being emailed (DECISIONS.md).
  const demo = isDemoEmail(email);
  if (demo) {
    if (!env().DEMO_MODE) throw badRequest("Demo accounts can only sign in while demo mode is on.", "DEMO_DISABLED");
    const account = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!account) throw badRequest("There's no demo account with this email.", "DEMO_ACCOUNT_NOT_FOUND");
  }

  const issued = await issueEmailCode(email, demo ? { maxPerHour: 30 } : {});

  let delivery: EmailStartResponse["delivery"] = "demo";
  if (demo) {
    console.info(`[auth] demo sign-in code for ${email}: ${issued.code}`);
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
    ...(demo ? { demoCode: issued.code } : {}),
  });
});
