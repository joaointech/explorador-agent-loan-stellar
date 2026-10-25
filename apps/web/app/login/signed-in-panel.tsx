"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/typography";
import type { Role } from "@/lib/auth/session-core";

/** Shown on /login when a session already exists: continue, or sign out to use another email. */
export function SignedInPanel({ email, role, continueTo }: { email: string; role: Role; continueTo: string }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } finally {
      window.location.reload();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Eyebrow>Signed in</Eyebrow>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-heading">Welcome back</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You&apos;re signed in as <span className="font-semibold break-words text-heading">{email}</span> ({role === "ADMIN" ? "admin" : "agent"}).
        </p>
      </div>
      <Button href={continueTo} fullWidth arrow>
        Continue
      </Button>
      <Button variant="ghost" fullWidth size="sm" onClick={() => void signOut()} loading={pending}>
        {pending ? "Signing out…" : "Sign out and use another email"}
      </Button>
    </div>
  );
}
