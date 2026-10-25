// POST /api/auth/email/verify {email, code, next?} → checks the code, creates
// the user on first sign-in (ADMIN if in ADMIN_EMAILS, else AGENT) and starts
// a pre-passkey session. Also the email fallback login for existing users.

import { verifyEmailCode } from "@/lib/auth/email-code";
import { clientIp, enforceRateLimit } from "@/lib/auth/rate-limit";
import { postLoginPath } from "@/lib/auth/redirect";
import { emailVerifyBody } from "@/lib/auth/schemas";
import { signIn } from "@/lib/auth/session";
import { findOrCreateUserByEmail } from "@/lib/auth/users";
import { parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import type { EmailVerifyResponse } from "@/lib/types/api";

const TEN_MINUTES = 10 * 60 * 1000;

export const POST = route(async (req: Request) => {
  enforceRateLimit(`email-verify:${clientIp(req)}`, 50, TEN_MINUTES, "sign-in attempts");
  const { email, code, next } = await parseBody(req, emailVerifyBody);

  await verifyEmailCode(email, code);
  const { user, created } = await findOrCreateUserByEmail(email);
  const sessionUser = await signIn(user, { passkeyVerified: false });

  return jsonResponse<EmailVerifyResponse>({
    user: sessionUser,
    isNewUser: created,
    redirectTo: postLoginPath(user.role, next),
  });
});
