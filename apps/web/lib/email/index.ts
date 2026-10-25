// Transactional email. Brevo (the provider explorador.pt already uses, see
// ../irrealista/core/email/brevo.py) when BREVO_API_KEY is set, otherwise
// Resend when RESEND_API_KEY is set; with neither (local dev) the message is
// printed to the server console instead of being sent.
import { Resend } from "resend";

import { env } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Brevo message tags, for filtering opens/clicks in Brevo's statistics. */
  tags?: string[];
}

export type EmailDelivery = { via: "brevo"; id: string } | { via: "resend"; id: string } | { via: "console" };

export class EmailError extends Error {}

export const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

export interface BrevoConfig {
  apiKey: string;
  sender: { email: string; name: string };
  /** Brevo validates the request but drops the email (`X-Sib-Sandbox: drop`). */
  sandbox?: boolean;
}

/** One transactional email through Brevo's `POST /v3/smtp/email`. The sender's domain must be authenticated in Brevo. */
export async function sendViaBrevo(message: EmailMessage, config: BrevoConfig): Promise<EmailDelivery> {
  const body = {
    sender: config.sender,
    to: [{ email: message.to }],
    subject: message.subject,
    textContent: message.text,
    ...(message.html ? { htmlContent: message.html } : {}),
    ...(message.tags?.length ? { tags: message.tags } : {}),
    ...(config.sandbox ? { headers: { "X-Sib-Sandbox": "drop" } } : {}),
  };
  let res: Response;
  try {
    res = await fetch(BREVO_SEND_URL, {
      method: "POST",
      headers: { "api-key": config.apiKey, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new EmailError(`Email request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const payload = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };
  if (!res.ok) {
    throw new EmailError(`Brevo rejected the email (${res.status}${payload.code ? ` ${payload.code}` : ""}): ${payload.message ?? res.statusText}`);
  }
  return { via: "brevo", id: payload.messageId ?? "" };
}

let resendCache: { apiKey: string; resend: Resend } | undefined;

function resendClient(apiKey: string): Resend {
  if (resendCache?.apiKey !== apiKey) resendCache = { apiKey, resend: new Resend(apiKey) };
  return resendCache.resend;
}

async function sendViaResend(message: EmailMessage, apiKey: string, from: string): Promise<EmailDelivery> {
  let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    result = await resendClient(apiKey).emails.send({
      from,
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

/** `Name <email>` → its parts (a bare address gets `fallbackName`). */
export function parseMailbox(value: string, fallbackName: string): { email: string; name: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || fallbackName, email: m[2].trim() };
  return { name: fallbackName, email: value.trim() };
}

/** True when emails are really sent (a provider key is configured). */
export const emailEnabled = (): boolean => Boolean(env().BREVO_API_KEY || env().RESEND_API_KEY);

/** Sends `message` through Brevo, else Resend, else logs it. Throws EmailError on failure. */
export async function sendEmail(message: EmailMessage): Promise<EmailDelivery> {
  const e = env();
  if (e.BREVO_API_KEY) {
    const fromEnv = parseMailbox(e.EMAIL_FROM, e.BREVO_SENDER_NAME);
    return sendViaBrevo(message, {
      apiKey: e.BREVO_API_KEY,
      sender: { email: e.BREVO_SENDER_EMAIL ?? fromEnv.email, name: e.BREVO_SENDER_NAME },
      sandbox: e.BREVO_SANDBOX,
    });
  }
  if (e.RESEND_API_KEY) return sendViaResend(message, e.RESEND_API_KEY, e.EMAIL_FROM);

  console.info(
    [
      "[email] No email provider configured (BREVO_API_KEY / RESEND_API_KEY); printing instead of sending.",
      `  from:    ${e.EMAIL_FROM}`,
      `  to:      ${message.to}`,
      `  subject: ${message.subject}`,
      ...message.text.split("\n").map((line) => `  | ${line}`),
    ].join("\n"),
  );
  return { via: "console" };
}
