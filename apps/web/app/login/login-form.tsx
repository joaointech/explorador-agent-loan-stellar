"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

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

const inputClass =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100";
const primaryButton =
  "inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-6 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600";
const linkButton =
  "font-semibold text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-blue-400";

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
      <form onSubmit={onEmailSubmit} className="space-y-5" noValidate>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Sign in</p>
          <h1 className="mt-2 text-2xl font-bold">Agents and admins</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Enter your email and we&apos;ll send you a 6-digit code. New agents get an account automatically.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-semibold">
            Email
          </label>
          <input
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
            className={inputClass}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
        {error && <ErrorMessage message={error.message} />}
        <button type="submit" className={primaryButton} disabled={pending || email.trim() === ""}>
          {pending ? "Sending…" : "Send code →"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onCodeSubmit} className="space-y-5" noValidate>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Sign in</p>
        <h1 className="mt-2 text-2xl font-bold">Enter your code</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {sent?.delivery === "demo" ? "Signing in as the demo agent " : "We sent a 6-digit code to "}
          <span className="font-semibold text-slate-900 dark:text-slate-100">{email}</span>. The code expires in 10
          minutes.
        </p>
      </div>

      {sent?.delivery === "console" && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Email isn&apos;t configured (no <code>RESEND_API_KEY</code>), so the code is printed in the server console.
        </p>
      )}
      {sent?.delivery === "demo" && sent.demoCode && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <span>
            Seeded demo agents have no inbox. Your code is{" "}
            <span className="font-mono font-bold tracking-widest tabular-nums">{sent.demoCode}</span>.
          </span>
          <button type="button" className={linkButton} disabled={pending} onClick={() => onCodeChange(sent.demoCode!)}>
            Use it
          </button>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="code" className="block text-sm font-semibold">
          6-digit code
        </label>
        <input
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
          className={`${inputClass} text-center font-mono text-xl tracking-[0.5em] tabular-nums`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>
      {error && <ErrorMessage message={error.message} />}
      <button type="submit" className={primaryButton} disabled={pending || code.length !== 6}>
        {pending ? "Signing in…" : "Sign in →"}
      </button>

      <div className="flex items-center justify-between text-sm">
        <button type="button" className={linkButton} onClick={useAnotherEmail} disabled={pending}>
          Use a different email
        </button>
        <button
          type="button"
          className={linkButton}
          onClick={() => void requestCode(email)}
          disabled={pending || resendIn > 0}
        >
          {resendIn > 0 ? `Resend in ${resendIn} s` : error && NEEDS_NEW_CODE.has(error.code) ? "Send a new code" : "Resend code"}
        </button>
      </div>
    </form>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      id="login-error"
      role="alert"
      className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200"
    >
      {message}
    </p>
  );
}
