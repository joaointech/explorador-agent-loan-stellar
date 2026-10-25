// Transactional email through Resend. Without RESEND_API_KEY (local dev) the
// message is printed to the server console instead of being sent.

import { Resend } from "resend";

import { env } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailDelivery = { via: "resend"; id: string } | { via: "console" };

export class EmailError extends Error {}

let client: { apiKey: string; resend: Resend } | undefined;

function resendClient(apiKey: string): Resend {
  if (client?.apiKey !== apiKey) client = { apiKey, resend: new Resend(apiKey) };
  return client.resend;
}

/** True when emails are really sent (RESEND_API_KEY is set). */
export const emailEnabled = (): boolean => Boolean(env().RESEND_API_KEY);

/** Sends `message` from EMAIL_FROM, or logs it when Resend isn't configured. Throws EmailError on failure. */
export async function sendEmail(message: EmailMessage): Promise<EmailDelivery> {
  const { RESEND_API_KEY, EMAIL_FROM } = env();
  if (!RESEND_API_KEY) {
    console.info(
      [
        "[email] RESEND_API_KEY is not set; printing instead of sending.",
        `  from:    ${EMAIL_FROM}`,
        `  to:      ${message.to}`,
        `  subject: ${message.subject}`,
        ...message.text.split("\n").map((line) => `  | ${line}`),
      ].join("\n"),
    );
    return { via: "console" };
  }

  let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    result = await resendClient(RESEND_API_KEY).emails.send({
      from: EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (err) {
    throw new EmailError(`Email request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (result.error) throw new EmailError(`Resend rejected the email: ${result.error.message}`);
  return { via: "resend", id: result.data.id };
}
