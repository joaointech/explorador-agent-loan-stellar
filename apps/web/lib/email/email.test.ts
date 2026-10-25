import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envValues = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/env", () => ({ env: () => envValues.current }));

import { BREVO_SEND_URL, EmailError, parseMailbox, sendEmail, sendViaBrevo } from "./index";
import { loginCodeEmail } from "./login-code";

const message = { to: "agent@example.com", subject: "123456 is your explorador advance code", text: "Your code is 123456.", html: "<p>123456</p>", tags: ["explorador-advance-login"] };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("sendViaBrevo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts one transactional email to /v3/smtp/email with the api-key header", async () => {
    const fetchMock = mockFetch(201, { messageId: "<abc@smtp-relay.mailin.fr>" });
    const delivery = await sendViaBrevo(message, { apiKey: "xkeysib-test", sender: { email: "joaointech@explorador.pt", name: "explorador advance" } });

    expect(delivery).toEqual({ via: "brevo", id: "<abc@smtp-relay.mailin.fr>" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BREVO_SEND_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "api-key": "xkeysib-test", "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: "joaointech@explorador.pt", name: "explorador advance" },
      to: [{ email: "agent@example.com" }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      tags: ["explorador-advance-login"],
    });
  });

  it("asks Brevo to drop the email in sandbox mode", async () => {
    const fetchMock = mockFetch(201, { messageId: "sandboxed" });
    await sendViaBrevo(message, { apiKey: "k", sender: { email: "a@explorador.pt", name: "x" }, sandbox: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).headers).toEqual({ "X-Sib-Sandbox": "drop" });
  });

  it("turns a Brevo error response into an EmailError with Brevo's message", async () => {
    mockFetch(400, { code: "invalid_parameter", message: "sender is invalid / inactive" });
    await expect(sendViaBrevo(message, { apiKey: "k", sender: { email: "nope@explorador.ai", name: "x" } })).rejects.toThrow(
      new EmailError("Brevo rejected the email (400 invalid_parameter): sender is invalid / inactive"),
    );
  });

  it("wraps network failures in an EmailError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(sendViaBrevo(message, { apiKey: "k", sender: { email: "a@explorador.pt", name: "x" } })).rejects.toBeInstanceOf(EmailError);
  });
});

describe("sendEmail provider selection", () => {
  beforeEach(() => {
    envValues.current = { EMAIL_FROM: "explorador advance <advance@explorador.ai>", BREVO_SENDER_NAME: "explorador advance", BREVO_SANDBOX: false };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses Brevo when BREVO_API_KEY is set, even if Resend is configured too", async () => {
    envValues.current = { ...envValues.current, BREVO_API_KEY: "xkeysib-test", BREVO_SENDER_EMAIL: "joaointech@explorador.pt", RESEND_API_KEY: "re_test" };
    const fetchMock = mockFetch(201, { messageId: "m1" });
    expect(await sendEmail(message)).toEqual({ via: "brevo", id: "m1" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).sender).toEqual({ email: "joaointech@explorador.pt", name: "explorador advance" });
  });

  it("falls back to EMAIL_FROM's address when BREVO_SENDER_EMAIL is unset", async () => {
    envValues.current = { ...envValues.current, BREVO_API_KEY: "xkeysib-test" };
    const fetchMock = mockFetch(201, { messageId: "m2" });
    await sendEmail(message);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).sender).toEqual({ email: "advance@explorador.ai", name: "explorador advance" });
  });

  it("prints to the console when no provider is configured", async () => {
    const fetchMock = mockFetch(500, {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await sendEmail(message)).toEqual({ via: "console" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(info.mock.calls[0][0]).toContain("Your code is 123456.");
    info.mockRestore();
  });
});

describe("helpers", () => {
  it("parses mailbox strings", () => {
    expect(parseMailbox("explorador advance <advance@explorador.ai>", "x")).toEqual({ name: "explorador advance", email: "advance@explorador.ai" });
    expect(parseMailbox('"explorador" <joaointech@explorador.pt>', "x")).toEqual({ name: "explorador", email: "joaointech@explorador.pt" });
    expect(parseMailbox("alertas@explorador.pt", "fallback")).toEqual({ name: "fallback", email: "alertas@explorador.pt" });
  });

  it("tags sign-in code emails for Brevo statistics", () => {
    expect(loginCodeEmail("a@example.com", "123456", 10).tags).toEqual(["explorador-advance-login"]);
  });
});
