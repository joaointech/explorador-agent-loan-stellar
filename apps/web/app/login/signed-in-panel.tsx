"use client";

import Link from "next/link";
import { useState } from "react";

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
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Signed in</p>
        <h1 className="mt-2 text-2xl font-bold">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          You&apos;re signed in as <span className="font-semibold text-slate-900 dark:text-slate-100">{email}</span> (
          {role === "ADMIN" ? "admin" : "agent"}).
        </p>
      </div>
      <Link
        href={continueTo}
        className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-6 text-base font-semibold text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        Continue →
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={pending}
        className="w-full text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-400 dark:text-blue-400"
      >
        {pending ? "Signing out…" : "Sign out and use another email"}
      </button>
    </div>
  );
}
