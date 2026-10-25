// "Your sign-in code" email (spec §4.2 step 1, §9.2).

import { sendEmail, type EmailDelivery, type EmailMessage } from "@/lib/email";

export function loginCodeEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  const subject = `${code} is your explorador advance code`;
  const text = [
    `Your explorador advance sign-in code is ${code}.`,
    "",
    `It expires in ${ttlMinutes} minutes and can only be used once.`,
    "If you didn't try to sign in, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
            <tr>
              <td style="background:#2563eb;border-radius:16px 16px 0 0;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:700;">
                explorador <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.18);font-size:12px;font-weight:600;vertical-align:middle;">advance</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px 8px;">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#64748b;">Sign-in code</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:24px;">Enter this code to sign in to explorador advance:</p>
                <p style="margin:0 0 24px;font-size:36px;font-weight:700;letter-spacing:0.3em;font-family:'SFMono-Regular',Menlo,Consolas,monospace;color:#2563eb;">${code}</p>
                <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#64748b;">It expires in ${ttlMinutes} minutes and can only be used once.</p>
                <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#64748b;">If you didn't try to sign in, you can ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e2e8f0;padding:16px 24px;font-size:12px;color:#94a3b8;">Testnet demo · not financial advice</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to, subject, text, html, tags: ["explorador-advance-login"] };
}

/** Emails a sign-in code (or prints it to the server console when no email provider is configured). */
export function sendLoginCode(to: string, code: string, ttlMinutes: number): Promise<EmailDelivery> {
  return sendEmail(loginCodeEmail(to, code, ttlMinutes));
}
