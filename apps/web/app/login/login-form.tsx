"use client";

import { KeyRound, Mail } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { PasskeySignInButton } from "@/components/passkey";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Eyebrow } from "@/components/ui/typography";
import { postLoginPath } from "@/lib/auth/redirect";
import type { ApiError, EmailStartResponse, EmailVerifyResponse } from "@/lib/types/api";

type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function postJson<T>(url: string, body: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: json as T };
    const error = (json as ApiError | null)?.error;
    return {
      ok: false,
      code: error?.code ?? `HTTP_${res.status}`,
      message: error?.message ?? "Something went wrong. Please try again.",
    };
  } catch {
    return { ok: false, code: "NETWORK", message: "Can't reach the server. Check your connection and try again." };
  }
}

/** Codes after which the current code is dead and the user needs a new one. */
const NEEDS_NEW_CODE = new Set(["CODE_EXPIRED", "CODE_NOT_FOUND", "CODE_USED", "TOO_MANY_ATTEMPTS"]);

const linkButton =
  "shrink-0 rounded font-semibold whitespace-nowrap text-primary-text underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-subtle disabled:no-underline";

export function LoginForm({ next }: { next?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<EmailStartResponse | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // Clock for the resend countdown, only while the code step is shown.
  useEffect(() => {
    if (step !== "code") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function requestCode(address: string) {
    setPending(true);
    setError(null);
    const result = await postJson<EmailStartResponse>("/api/auth/email/start", { email: address });
    setPending(false);
    if (!result.ok) {
      setError(result);
      return;
    }
    setSent(result.data);
    setEmail(result.data.email);
    setCode("");
    setResendAt(Date.now() + result.data.resendAfterSecs * 1000);
    setNow(Date.now());
    setStep("code");
  }

  async function submitCode(value: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await postJson<EmailVerifyResponse>("/api/auth/email/verify", { email, code: value, next });
    if (result.ok) {
      // Full navigation so the new session cookie applies everywhere (proxy, server components).
      window.location.assign(result.data.redirectTo);
      return;
    }
    setPending(false);
    setError(result);
    setCode("");
    codeInput.current?.focus();
  }

  function onEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestCode(email);
  }

  function onCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length === 6) void submitCode(code);
    else setError({ code: "VALIDATION_ERROR", message: "Enter the 6-digit code." });
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void submitCode(digits);
  }

  function useAnotherEmail() {
    setStep("email");
    setSent(null);
    setCode("");
    setError(null);
  }

  if (step === "email") {
    return (
      <div>
        <Eyebrow>Sign in</Eyebrow>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-heading">Agents and admins</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Use your passkey, or get a 6-digit code by email. New agents get an account automatically.
        </p>

        <div className="mt-6">
          <PasskeySignInButton
            className={buttonClasses({ variant: "secondary", fullWidth: true })}
            redirect={false}
            // Full navigation (like the email flow) so the new session applies everywhere; honours a safe `next`.
            onSignedIn={(res) => window.location.assign(postLoginPath(res.user.role, next))}
          >
            <KeyRound aria-hidden className="size-4" />
            Sign in with passkey
          </PasskeySignInButton>
        </div>

        <div className="my-6 flex items-center gap-3 text-xs font-medium tracking-wide text-subtle uppercase" role="separator" aria-label="or">
          <span className="h-px flex-1 bg-line" />
          or use your email
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={onEmailSubmit} className="flex flex-col gap-5" noValidate>
          <Field id="email" label="Email">
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              placeholder="you@example.com"
              prefix={<Mail />}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </Field>
          {error && <ErrorMessage message={error.message} />}
          <Button type="submit" fullWidth arrow={!pending} loading={pending} disabled={email.trim() === ""}>
            {pending ? "Sending…" : "Send code"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={onCodeSubmit} className="flex flex-col gap-5" noValidate>
      <div>
        <Eyebrow>Sign in</Eyebrow>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-heading">Enter your code</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {sent?.delivery === "demo" ? "Signing in as the demo account " : "We sent a 6-digit code to "}
          <span className="font-semibold break-words text-heading">{email}</span>. The code expires in 10 minutes.
        </p>
      </div>

      {sent?.delivery === "console" && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-200">
          Email isn&apos;t configured (no <code className="font-mono text-xs">RESEND_API_KEY</code>), so the code is printed in the server console.
        </p>
      )}
      {sent?.delivery === "demo" && sent.demoCode && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-primary-tint px-4 py-3 text-sm text-blue-900 ring-1 ring-primary/15 dark:text-blue-200">
          <span>
            Seeded demo accounts have no inbox. Your code is <span className="font-mono font-bold tracking-widest tabular-nums">{sent.demoCode}</span>.
          </span>
          <button type="button" className={linkButton} disabled={pending} onClick={() => onCodeChange(sent.demoCode!)}>
            Use it
          </button>
        </div>
      )}

      <Field id="code" label="6-digit code">
        <Input
          ref={codeInput}
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          disabled={pending}
          placeholder="123456"
          inputClassName="h-12 text-center font-mono text-xl tracking-[0.5em] tabular-nums"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </Field>
      {error && <ErrorMessage message={error.message} />}
      <Button type="submit" fullWidth arrow={!pending} loading={pending} disabled={code.length !== 6}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="flex items-center justify-between gap-4 text-sm">
        <button type="button" className={linkButton} onClick={useAnotherEmail} disabled={pending}>
          Use a different email
        </button>
        <button type="button" className={linkButton} onClick={() => void requestCode(email)} disabled={pending || resendIn > 0}>
          {resendIn > 0 ? `Resend in ${resendIn} s` : error && NEEDS_NEW_CODE.has(error.code) ? "Send a new code" : "Resend code"}
        </button>
      </div>
    </form>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p id="login-error" role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-600/15 dark:bg-red-500/10 dark:text-red-200">
      {message}
    </p>
  );
}
