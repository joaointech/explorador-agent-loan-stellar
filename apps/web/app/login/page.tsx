// /login: email → 6-digit code sign-in (spec §4.2 step 1, §9.2). Minimal
// styling on purpose; the agent app restyles it with the design system and
// adds passkey sign-in (`/api/auth/passkey/login/*`, Smart accounts workstream).

import type { Metadata } from "next";

import { postLoginPath, sanitizeNextPath } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";

import { LoginForm } from "./login-form";
import { SignedInPanel } from "./signed-in-panel";

export const metadata: Metadata = {
  title: "Sign in · explorador advance",
  robots: { index: false },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = sanitizeNextPath(Array.isArray(next) ? next[0] : next) ?? undefined;
  const user = await getSessionUser();

  return (
    <main className="flex flex-1 items-center justify-center bg-[#f6f5f1] px-4 py-16 text-slate-900 dark:bg-[#0b1120] dark:text-slate-100">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-xl font-bold tracking-tight">
          explorador
          <span className="ml-2 inline-block rounded-full bg-blue-600 px-2.5 py-0.5 align-middle text-xs font-semibold text-white">
            advance
          </span>
        </p>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-6 sm:p-8 dark:border-slate-700/70 dark:bg-slate-900">
          {user ? (
            <SignedInPanel email={user.email} role={user.role} continueTo={postLoginPath(user.role, nextPath)} />
          ) : (
            <LoginForm next={nextPath} />
          )}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">Testnet demo · not financial advice</p>
      </div>
    </main>
  );
}
