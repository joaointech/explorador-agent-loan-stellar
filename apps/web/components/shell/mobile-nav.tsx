"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";

import { Avatar } from "./account-menu";
import { isActivePath, SIGN_IN_HREF, signOut, type HeaderUser, type NavLink } from "./nav";

/**
 * Mobile menu (below lg), modelled on explorador.pt: the hamburger turns into
 * an X and a full-width brand-blue panel drops down under the header over a
 * dimmed backdrop. Panel and backdrop are positioned against the sticky
 * <header> (`top-full`), so no measuring is needed. While closed the panel is
 * `inert` (not focusable, hidden from assistive tech).
 */
export function MobileNav({ links, user }: { links: NavLink[]; user: HeaderUser | null }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname() ?? "/";
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => {
      if (desktop.matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-11 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 lg:hidden"
      >
        {open ? <X aria-hidden className="size-6" /> : <Menu aria-hidden className="size-6" />}
      </button>

      <div
        aria-hidden
        onClick={close}
        className={cn(
          "absolute inset-x-0 top-full h-dvh bg-slate-950/40 transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none invisible opacity-0",
        )}
      />

      <div
        ref={panelRef}
        id={panelId}
        inert={!open}
        className={cn(
          "absolute inset-x-0 top-full overflow-hidden rounded-b-2xl bg-primary text-white shadow-pop transition-[opacity,transform,visibility] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden dark:bg-slate-900",
          open ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible -translate-y-2 opacity-0",
        )}
      >
        <nav aria-label="Main" className="flex flex-col gap-1 px-3 py-3">
          {links.map((link) => {
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center rounded-xl px-4 py-3 text-base transition-colors",
                  active ? "bg-white/15 font-semibold" : "font-medium hover:bg-white/10",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {user ? (
          <div className="flex items-center gap-3 border-t border-white/15 p-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
              <Avatar email={user.email} className="size-9" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{user.email}</span>
                <span className="text-xs text-white/70">{user.role === "ADMIN" ? "Admin" : "Agent"}</span>
              </span>
            </div>
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut();
              }}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium transition-colors hover:bg-white/25 disabled:opacity-60"
            >
              <LogOut aria-hidden className="size-4" />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : (
          <div className="border-t border-white/15 p-3">
            <Link
              href={SIGN_IN_HREF}
              onClick={close}
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-black dark:bg-primary dark:hover:bg-primary/85"
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
