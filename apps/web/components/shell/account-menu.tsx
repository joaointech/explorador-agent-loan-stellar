"use client";

import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";

import { SIGN_IN_HREF, signOut, type HeaderUser } from "./nav";

/** First letter of the email, upper-cased: the avatar fallback. */
export function userInitial(email: string): string {
  return (email.trim()[0] ?? "?").toUpperCase();
}

export function Avatar({ email, className }: { email: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-semibold text-white ring-1 ring-white/40",
        className,
      )}
    >
      {userInitial(email)}
    </span>
  );
}

/** Desktop "Sign in" button on the blue bar (explorador.pt account button). */
export function SignInButton({ className }: { className?: string }) {
  return (
    <Link
      href={SIGN_IN_HREF}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-xl bg-white/15 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/25",
        className,
      )}
    >
      Sign in
    </Link>
  );
}

/** Desktop account control: avatar button with a small popover (email, role, sign out). */
export function AccountMenu({ user }: { user: HeaderUser }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${user.email}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded-full transition-opacity hover:opacity-85"
      >
        <Avatar email={user.email} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full right-0 z-50 mt-2 w-64 rounded-xl border border-line bg-card p-1.5 text-fg shadow-pop"
      >
        <div className="px-3 py-2">
          <p className="truncate text-sm font-semibold text-heading">{user.email}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            {user.role === "ADMIN" ? (
              <ShieldCheck aria-hidden className="size-3.5" />
            ) : (
              <UserRound aria-hidden className="size-3.5" />
            )}
            {user.role === "ADMIN" ? "Admin" : "Agent"}
          </p>
        </div>
        <div className="my-1 h-px bg-line" />
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void signOut();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <LogOut aria-hidden className="size-4" />
          {pending ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
