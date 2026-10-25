"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Fingerprint, Mail, ShieldCheck } from "lucide-react";
import { Eyebrow, ErrorNote } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost, errorMessage } from "@/lib/client/api";
import { loginWithPasskey, registerPasskey } from "@/lib/client/passkey";

type Step = "email" | "code" | "passkey";
type Role = "AGENT" | "ADMIN";

function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

export function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = React.useState<Step>("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [role, setRole] = React.useState<Role>("AGENT");
  const [busy, setBusy] = React.useState<null | "email" | "code" | "passkey" | "login">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  function finish(r: Role) {
    const target = next ?? (r === "ADMIN" ? "/admin" : "/agent");
    router.push(target);
    router.refresh();
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy("email");
    try {
      await apiPost<{ ok: true }>("/api/auth/email/start", { email: email.trim().toLowerCase() });
      setStep("code");
      setCode("");
      setNotice(`We sent a 6-digit code to ${email.trim().toLowerCase()}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy("code");
    try {
      const r = await apiPost<{ ok: true; role: Role; needsPasskey: boolean }>("/api/auth/email/verify", {
        email: email.trim().toLowerCase(),
        code: code.trim(),
      });
      setRole(r.role);
      if (r.needsPasskey) {
        setStep("passkey");
        setNotice(null);
      } else {
        finish(r.role);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function createPasskey() {
    setError(null);
    setBusy("passkey");
    try {
      await registerPasskey();
      finish(role);
    } catch (err) {
      setError(friendlyWebAuthnError(err));
    } finally {
      setBusy(null);
    }
  }

  async function signInWithPasskey() {
    setError(null);
    setBusy("login");
    try {
      const r = await loginWithPasskey();
      finish(r.role);
    } catch (err) {
      setError(friendlyWebAuthnError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-fade-in-up">
      <Eyebrow>explorador advance</Eyebrow>
      <h1 className="mt-2 text-[32px] font-bold leading-tight tracking-tight">
        {step === "passkey" ? (
          <>
            One last step. <span className="block text-primary">Create your passkey.</span>
          </>
        ) : (
          <>
            Welcome back. <span className="block text-primary">Sign in to continue.</span>
          </>
        )}
      </h1>

      <Card className="mt-6 p-5 sm:p-6">
        {step === "email" && (
          <div className="flex flex-col gap-5">
            <Button size="lg" onClick={signInWithPasskey} loading={busy === "login"} disabled={!!busy}>
              <Fingerprint /> Sign in with passkey
            </Button>
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              <span className="h-px flex-1 bg-line" /> or use your email <span className="h-px flex-1 bg-line" />
            </div>
            <form onSubmit={sendCode} className="flex flex-col gap-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email webauthn"
                  required
                  placeholder="you@explorador.pt"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" variant="secondary" loading={busy === "email"} disabled={!!busy || !email.includes("@")}>
                <Mail /> Email me a code →
              </Button>
            </form>
          </div>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode} className="flex flex-col gap-4">
            {notice && <p className="text-sm text-muted">{notice}</p>}
            <div>
              <Label htmlFor="code">6-digit code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="000000"
                className="text-center font-mono text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <Button type="submit" loading={busy === "code"} disabled={!!busy || code.length !== 6}>
              Continue →
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => setStep("email")}>
                <ArrowLeft className="size-4" /> Change email
              </button>
              <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => sendCode()}>
                Resend code
              </button>
            </div>
          </form>
        )}

        {step === "passkey" && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-3 rounded-2xl bg-primary-faint p-4">
              <ShieldCheck className="mt-0.5 size-6 shrink-0 text-primary" />
              <div className="text-sm leading-relaxed text-ink-soft">
                {role === "AGENT" ? (
                  <>
                    Your passkey is how you sign in and how you approve card spending. It uses Face ID, Touch ID or your device PIN — there is
                    nothing to write down.
                  </>
                ) : (
                  <>Your passkey secures the admin panel. It uses Face ID, Touch ID or your device PIN.</>
                )}
              </div>
            </div>
            <Button size="lg" onClick={createPasskey} loading={busy === "passkey"} disabled={!!busy}>
              <Fingerprint /> Create passkey →
            </Button>
            {busy === "passkey" && role === "AGENT" && (
              <p className="text-center text-xs text-muted">Setting up your account and card… this can take a few seconds.</p>
            )}
          </div>
        )}

        {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
      </Card>

      <p className="mt-4 text-center text-xs text-muted">Testnet demo · no KYC · no real money.</p>
    </div>
  );
}

function friendlyWebAuthnError(err: unknown): string {
  const msg = errorMessage(err);
  if (/NotAllowedError|timed out|not allowed/i.test(msg)) return "The passkey prompt was cancelled or timed out. Please try again.";
  if (/InvalidStateError|already registered/i.test(msg)) return "This device already has a passkey for this account — use “Sign in with passkey”.";
  return msg;
}
